Set-StrictMode -Version Latest

$runnerModulePath = Join-Path $PSScriptRoot 'ProductionRolloutRunner.Core.psm1'
try {
    Add-Type -AssemblyName System.Security -ErrorAction Stop
    Import-Module $runnerModulePath -ErrorAction Stop
}
catch {
    throw 'MODULE_IMPORT_FAILED'
}

$script:Entropy = [System.Text.Encoding]::UTF8.GetBytes('ChengyeOA.LocalPreproduction.v1')
$script:RequiredApplicationKeys = @(
    'DATABASE_URL', 'JWT_SECRET', 'APP_KEYS',
    'CORS_ALLOWED_ORIGINS', 'MFA_ENCRYPTION_KEY_V1', 'NODE_ENV'
)
$script:BundleKeys = @(
    'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT',
    'POSTGRES_TEST_USER', 'POSTGRES_TEST_PASSWORD', 'POSTGRES_TEST_DB',
    'DATABASE_URL', 'JWT_SECRET', 'APP_KEYS', 'CORS_ALLOWED_ORIGINS',
    'MFA_ENCRYPTION_KEY_V1', 'NODE_ENV', 'EVENT_WORKER_ENABLED', 'HOST', 'PORT'
)
$script:SnapshotFields = @(
    'status', 'undispatched', 'dueBacklog', 'manual', 'processing',
    'expiredProcessing', 'staleExpiredProcessing', 'leaseLost15m'
)

function New-LocalSafeRecord {
    param(
        [Parameter(Mandatory)][string]$Phase,
        [Parameter(Mandatory)][string]$Status,
        [Parameter(Mandatory)][hashtable]$BoundedCounts,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$AlertCodes,
        [Parameter(Mandatory)][datetime]$UtcStart
    )

    return New-SafeStatusRecord `
        -Phase $Phase `
        -Status $Status `
        -BoundedCounts $BoundedCounts `
        -AlertCodes $AlertCodes `
        -UtcStart $UtcStart `
        -UtcEnd ([datetime]::UtcNow)
}

function New-RandomBase64 {
    param([Parameter(Mandatory)][ValidateRange(1, 4096)][int]$ByteCount)

    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
        return [Convert]::ToBase64String($bytes)
    }
    finally {
        $generator.Dispose()
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
}

function New-LocalPreproductionMaterial {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateRange(1024, 65535)][int]$ApplicationPort,
        [Parameter(Mandatory)][ValidateRange(1024, 65535)][int]$DatabasePort
    )

    $dbUser = 'chengyeoa_preprod'
    $dbName = 'chengyeoa_preprod'
    $dbPassword = New-RandomBase64 -ByteCount 36
    $originBuilder = New-Object System.UriBuilder('http', '127.0.0.1', $ApplicationPort)
    $origin = $originBuilder.Uri.GetLeftPart([System.UriPartial]::Authority)
    $databaseBuilder = New-Object System.UriBuilder('postgresql', '127.0.0.1', $DatabasePort, $dbName)
    $databaseBuilder.UserName = $dbUser
    $databaseBuilder.Password = [Uri]::EscapeDataString($dbPassword)
    $databaseUri = $databaseBuilder.Uri
    $databaseUrl = $databaseUri.AbsoluteUri

    return [ordered]@{
        POSTGRES_USER = $dbUser
        POSTGRES_PASSWORD = $dbPassword
        POSTGRES_DB = $dbName
        POSTGRES_PORT = [string]$DatabasePort
        POSTGRES_TEST_USER = 'chengyeoa_preprod_test'
        POSTGRES_TEST_PASSWORD = (New-RandomBase64 -ByteCount 36)
        POSTGRES_TEST_DB = 'chengyeoa_preprod_test'
        DATABASE_URL = $databaseUrl
        JWT_SECRET = (New-RandomBase64 -ByteCount 48)
        APP_KEYS = "$(New-RandomBase64 -ByteCount 32),$(New-RandomBase64 -ByteCount 32)"
        CORS_ALLOWED_ORIGINS = $origin
        MFA_ENCRYPTION_KEY_V1 = (New-RandomBase64 -ByteCount 32)
        NODE_ENV = 'production'
        EVENT_WORKER_ENABLED = 'false'
        HOST = '127.0.0.1'
        PORT = [string]$ApplicationPort
    }
}

function Set-RestrictedStorageAcl {
    param([Parameter(Mandatory)][string]$LiteralPath)

    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = New-Object System.Security.Principal.SecurityIdentifier(
        [System.Security.Principal.WellKnownSidType]::LocalSystemSid,
        $null
    )
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [System.Security.AccessControl.PropagationFlags]::None
    $allow = [System.Security.AccessControl.AccessControlType]::Allow
    foreach ($sid in @($currentSid, $systemSid)) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            $propagation,
            $allow
        )
        [void]$security.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $LiteralPath -AclObject $security -ErrorAction Stop
}

function Assert-SafeStorageTarget {
    param(
        [Parameter(Mandatory)][string]$LiteralPath,
        [Parameter(Mandatory)][string]$ApprovedRoot
    )

    try {
        if ([string]::IsNullOrWhiteSpace($LiteralPath) -or
            [string]::IsNullOrWhiteSpace($ApprovedRoot) -or
            $LiteralPath -match '^[^\\/:]+::' -or
            $ApprovedRoot -match '^[^\\/:]+::' -or
            -not [System.IO.Path]::IsPathRooted($LiteralPath) -or
            -not [System.IO.Path]::IsPathRooted($ApprovedRoot)) {
            throw 'INVALID'
        }

        $targetPath = [System.IO.Path]::GetFullPath($LiteralPath)
        $approvedPath = [System.IO.Path]::GetFullPath($ApprovedRoot).TrimEnd([char[]]'\\/')
        $parentPath = [System.IO.Path]::GetDirectoryName($targetPath).TrimEnd([char[]]'\\/')
        $pathRoot = [System.IO.Path]::GetPathRoot($targetPath)
        if ([string]::IsNullOrWhiteSpace($pathRoot) -or
            $pathRoot -notmatch '^[A-Za-z]:\\$' -or
            $parentPath -cne $approvedPath) {
            throw 'INVALID'
        }

        $relativeTarget = $targetPath.Substring($pathRoot.Length)
        $currentPath = $pathRoot
        foreach ($component in $relativeTarget.Split([char[]]'\\/', [System.StringSplitOptions]::RemoveEmptyEntries)) {
            $currentPath = [System.IO.Path]::Combine($currentPath, $component)
            if (Test-Path -LiteralPath $currentPath) {
                $item = Get-Item -LiteralPath $currentPath -Force -ErrorAction Stop
                if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                    throw 'INVALID'
                }
            }
        }

        return [pscustomobject]@{
            TargetPath = $targetPath
            ParentPath = $parentPath
            ApprovedRoot = $approvedPath
        }
    }
    catch {
        throw 'SECRET_STORAGE_PATH_INVALID'
    }
}

function Get-StorageMutexName {
    param([Parameter(Mandatory)][string]$TargetPath)

    $canonical = [System.IO.Path]::GetFullPath($TargetPath).ToLowerInvariant()
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $algorithm.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonical))
        return 'Local\ChengyeOA.LocalPreproduction.' + ([BitConverter]::ToString($digest).Replace('-', ''))
    }
    finally {
        $algorithm.Dispose()
    }
}

function Protect-LocalPreproductionBundle {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$Material,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$LiteralPath,
        [string]$ApprovedRoot
    )

    if ([string]::IsNullOrWhiteSpace($ApprovedRoot)) {
        if ($LiteralPath -match '^[^\\/:]+::' -or -not [System.IO.Path]::IsPathRooted($LiteralPath)) {
            throw 'SECRET_STORAGE_PATH_INVALID'
        }
        try {
            $ApprovedRoot = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($LiteralPath))
        }
        catch {
            throw 'SECRET_STORAGE_PATH_INVALID'
        }
    }
    $validated = Assert-SafeStorageTarget -LiteralPath $LiteralPath -ApprovedRoot $ApprovedRoot
    if (Test-Path -LiteralPath $validated.TargetPath) {
        throw 'SECRET_BUNDLE_ALREADY_EXISTS'
    }

    $plainBytes = $null
    $protectedBytes = $null
    $stream = $null
    $mutex = $null
    $ownsMutex = $false
    try {
        $mutex = New-Object System.Threading.Mutex($false, (Get-StorageMutexName -TargetPath $validated.TargetPath))
        try {
            $ownsMutex = $mutex.WaitOne(10000)
        }
        catch [System.Threading.AbandonedMutexException] {
            $ownsMutex = $true
        }
        if (-not $ownsMutex) {
            throw 'SERIALIZATION_TIMEOUT'
        }

        $validated = Assert-SafeStorageTarget -LiteralPath $validated.TargetPath -ApprovedRoot $validated.ApprovedRoot
        if (Test-Path -LiteralPath $validated.TargetPath) {
            throw 'SECRET_BUNDLE_ALREADY_EXISTS'
        }
        if (-not (Test-Path -LiteralPath $validated.ParentPath -PathType Container)) {
            New-Item -ItemType Directory -Path $validated.ParentPath -Force -ErrorAction Stop | Out-Null
        }
        $validated = Assert-SafeStorageTarget -LiteralPath $validated.TargetPath -ApprovedRoot $validated.ApprovedRoot
        Set-RestrictedStorageAcl -LiteralPath $validated.ParentPath

        $json = $Material | ConvertTo-Json -Compress -Depth 4
        $plainBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
            $plainBytes,
            $script:Entropy,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        $ciphertextBytes = [System.Text.Encoding]::ASCII.GetBytes([Convert]::ToBase64String($protectedBytes))
        $validated = Assert-SafeStorageTarget -LiteralPath $validated.TargetPath -ApprovedRoot $validated.ApprovedRoot
        $stream = New-Object System.IO.FileStream(
            $validated.TargetPath,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        $stream.Write($ciphertextBytes, 0, $ciphertextBytes.Length)
        $stream.Flush($true)
    }
    catch {
        if ([string]$_.Exception.Message -ceq 'SECRET_STORAGE_PATH_INVALID') {
            throw 'SECRET_STORAGE_PATH_INVALID'
        }
        if ([string]$_.Exception.Message -ceq 'SECRET_BUNDLE_ALREADY_EXISTS') {
            throw 'SECRET_BUNDLE_ALREADY_EXISTS'
        }
        if (Test-Path -LiteralPath $validated.TargetPath) {
            if ($null -eq $stream) {
                throw 'SECRET_BUNDLE_ALREADY_EXISTS'
            }
        }
        throw 'SECRET_BUNDLE_WRITE_FAILED'
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
        if ($null -ne $plainBytes) {
            [Array]::Clear($plainBytes, 0, $plainBytes.Length)
        }
        if ($null -ne $protectedBytes) {
            [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
        }
        if ($ownsMutex) {
            $mutex.ReleaseMutex()
        }
        if ($null -ne $mutex) {
            $mutex.Dispose()
        }
    }
}

function Unprotect-LocalPreproductionBundle {
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$LiteralPath)

    $plainBytes = $null
    $protectedBytes = $null
    try {
        $ciphertext = [System.IO.File]::ReadAllText($LiteralPath, [System.Text.Encoding]::ASCII)
        if ([string]::IsNullOrWhiteSpace($ciphertext)) {
            throw 'INVALID'
        }
        $protectedBytes = [Convert]::FromBase64String($ciphertext)
        if ([Convert]::ToBase64String($protectedBytes) -cne $ciphertext) {
            throw 'INVALID'
        }
        $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $protectedBytes,
            $script:Entropy,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        $decoded = [System.Text.Encoding]::UTF8.GetString($plainBytes)
        $object = $decoded | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $object -or $object -is [System.Array] -or $object -is [string]) {
            throw 'INVALID'
        }
        $result = @{}
        foreach ($property in $object.PSObject.Properties) {
            $result[[string]$property.Name] = $property.Value
        }
        if ($result.Count -eq 0) {
            throw 'INVALID'
        }
        return $result
    }
    catch {
        throw 'SECRET_BUNDLE_INVALID'
    }
    finally {
        if ($null -ne $plainBytes) {
            [Array]::Clear($plainBytes, 0, $plainBytes.Length)
        }
        if ($null -ne $protectedBytes) {
            [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
        }
    }
}

function Test-CanonicalMfaKey {
    param([string]$Value)

    try {
        if ([string]::IsNullOrWhiteSpace($Value)) {
            return $false
        }
        $bytes = [Convert]::FromBase64String($Value)
        return $bytes.Length -eq 32 -and [Convert]::ToBase64String($bytes) -ceq $Value
    }
    catch {
        return $false
    }
}

function Test-LoopbackOrigin {
    param([string]$Value)

    $uri = $null
    if ([string]::IsNullOrWhiteSpace($Value) -or -not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri)) {
        return $false
    }
    $address = $null
    if (-not [System.Net.IPAddress]::TryParse($uri.Host, [ref]$address)) {
        return $false
    }
    return $uri.Scheme -ceq 'http' -and
        [System.Net.IPAddress]::IsLoopback($address) -and
        [string]::IsNullOrEmpty($uri.UserInfo) -and
        [string]::IsNullOrEmpty($uri.Query) -and
        [string]::IsNullOrEmpty($uri.Fragment) -and
        $uri.AbsolutePath -ceq '/' -and
        $uri.GetLeftPart([UriPartial]::Authority) -ceq $Value
}

function Test-ExactDictionaryKey {
    param(
        [System.Collections.IDictionary]$Dictionary,
        [string]$Name
    )

    foreach ($key in $Dictionary.Keys) {
        if ([string]$key -ceq $Name) {
            return $true
        }
    }
    return $false
}

function Test-LocalPreproductionEnvironment {
    [CmdletBinding()]
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Environment)

    $started = [datetime]::UtcNow
    $alerts = New-Object System.Collections.Generic.List[string]
    $presentCount = 0
    foreach ($name in $script:RequiredApplicationKeys) {
        if ((Test-ExactDictionaryKey -Dictionary $Environment -Name $name) -and -not [string]::IsNullOrWhiteSpace([string]$Environment[$name])) {
            $presentCount++
        }
    }
    foreach ($name in $script:BundleKeys) {
        if (-not (Test-ExactDictionaryKey -Dictionary $Environment -Name $name) -or [string]::IsNullOrWhiteSpace([string]$Environment[$name])) {
            if (-not $alerts.Contains('ENV_REQUIRED_MISSING')) {
                $alerts.Add('ENV_REQUIRED_MISSING')
            }
        }
    }
    foreach ($name in $Environment.Keys) {
        if ([string]$name -cnotin $script:BundleKeys) {
            if (-not $alerts.Contains('ENV_UNEXPECTED_KEY')) {
                $alerts.Add('ENV_UNEXPECTED_KEY')
            }
        }
    }
    if (-not (Test-ExactDictionaryKey -Dictionary $Environment -Name 'NODE_ENV') -or [string]$Environment['NODE_ENV'] -cne 'production') {
        $alerts.Add('NODE_ENV_NOT_PRODUCTION')
    }
    if (-not (Test-ExactDictionaryKey -Dictionary $Environment -Name 'EVENT_WORKER_ENABLED') -or [string]$Environment['EVENT_WORKER_ENABLED'] -cne 'false') {
        $alerts.Add('EVENT_WORKER_NOT_DISABLED')
    }

    $appKeysValid = $false
    if (Test-ExactDictionaryKey -Dictionary $Environment -Name 'APP_KEYS') {
        $appKeys = @(([string]$Environment['APP_KEYS']).Split(','))
        $appKeysValid = $appKeys.Count -eq 2 -and @($appKeys | Where-Object { $_.Length -lt 24 }).Count -eq 0
    }
    if (-not $appKeysValid) {
        $alerts.Add('APP_KEYS_INVALID')
    }
    if (-not (Test-ExactDictionaryKey -Dictionary $Environment -Name 'MFA_ENCRYPTION_KEY_V1') -or -not (Test-CanonicalMfaKey -Value ([string]$Environment['MFA_ENCRYPTION_KEY_V1']))) {
        $alerts.Add('MFA_KEY_INVALID')
    }
    if (-not (Test-ExactDictionaryKey -Dictionary $Environment -Name 'CORS_ALLOWED_ORIGINS') -or -not (Test-LoopbackOrigin -Value ([string]$Environment['CORS_ALLOWED_ORIGINS']))) {
        $alerts.Add('CORS_ORIGIN_INVALID')
    }

    $samplePattern = '(?i)(change[-_ ]?me|replace[-_ ]?me|placeholder|example|sample|default[-_ ]?(secret|password|key)|your[-_ ])'
    foreach ($name in @('POSTGRES_PASSWORD', 'POSTGRES_TEST_PASSWORD', 'DATABASE_URL', 'JWT_SECRET', 'APP_KEYS', 'MFA_ENCRYPTION_KEY_V1')) {
        if ((Test-ExactDictionaryKey -Dictionary $Environment -Name $name) -and [string]$Environment[$name] -match $samplePattern) {
            if (-not $alerts.Contains('ENV_SAMPLE_VALUE')) {
                $alerts.Add('ENV_SAMPLE_VALUE')
            }
        }
    }

    $status = if ($alerts.Count -eq 0) { 'READY' } else { 'BLOCKED' }
    return New-LocalSafeRecord `
        -Phase 'local_preproduction_environment_validation' `
        -Status $status `
        -BoundedCounts @{ requiredPresent = $presentCount; requiredTotal = $script:RequiredApplicationKeys.Count } `
        -AlertCodes @($alerts) `
        -UtcStart $started
}

function Get-SnapshotValue {
    param(
        [object]$Snapshot,
        [string]$Name,
        [ref]$Exists
    )

    $Exists.Value = $false
    if ($null -eq $Snapshot) {
        return $null
    }
    if ($Snapshot -is [System.Collections.IDictionary]) {
        if ($Snapshot.Contains($Name)) {
            $Exists.Value = $true
            return $Snapshot[$Name]
        }
        return $null
    }
    $property = $Snapshot.PSObject.Properties[$Name]
    if ($null -ne $property) {
        $Exists.Value = $true
        return $property.Value
    }
    return $null
}

function Compare-EventPreflightSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][object]$Source,
        [Parameter(Mandatory)][object]$Portable
    )

    $started = [datetime]::UtcNow
    $matches = $true
    foreach ($field in $script:SnapshotFields) {
        $sourceExists = $false
        $portableExists = $false
        $sourceValue = Get-SnapshotValue -Snapshot $Source -Name $field -Exists ([ref]$sourceExists)
        $portableValue = Get-SnapshotValue -Snapshot $Portable -Name $field -Exists ([ref]$portableExists)
        if (-not $sourceExists -or -not $portableExists -or $sourceValue -cne $portableValue) {
            $matches = $false
        }
    }
    $sourceStatusExists = $false
    $portableStatusExists = $false
    $sourceStatus = Get-SnapshotValue -Snapshot $Source -Name 'status' -Exists ([ref]$sourceStatusExists)
    $portableStatus = Get-SnapshotValue -Snapshot $Portable -Name 'status' -Exists ([ref]$portableStatusExists)
    if (-not $sourceStatusExists -or -not $portableStatusExists -or [string]$sourceStatus -cne 'READY' -or [string]$portableStatus -cne 'READY') {
        $matches = $false
    }
    $snapshotAlerts = @()
    if (-not $matches) {
        $snapshotAlerts = @('PREFLIGHT_SNAPSHOT_MISMATCH')
    }

    return New-LocalSafeRecord `
        -Phase 'local_preproduction_snapshot_comparison' `
        -Status $(if ($matches) { 'READY' } else { 'BLOCKED' }) `
        -BoundedCounts @{ durableFieldsCompared = $script:SnapshotFields.Count } `
        -AlertCodes $snapshotAlerts `
        -UtcStart $started
}

function ConvertTo-LocalNativeArgument {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Value)

    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
        return $Value
    }
    return '"' + ([regex]::Replace($Value, '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

function New-LocalNativeContainment {
    if ($null -eq ('ChengyeOA.LocalPreproduction.NativeJob' -as [type])) {
        $source = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace ChengyeOA.LocalPreproduction
{
    public sealed class NativeJob : IDisposable
    {
        private IntPtr handle;
        private bool disposed;

        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimitInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public IntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ExtendedLimitInformation
        {
            public BasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct BasicAccountingInformation
        {
            public long TotalUserTime;
            public long TotalKernelTime;
            public long ThisPeriodTotalUserTime;
            public long ThisPeriodTotalKernelTime;
            public uint TotalPageFaultCount;
            public uint TotalProcesses;
            public uint ActiveProcesses;
            public uint TotalTerminatedProcesses;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool QueryInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint length, IntPtr returnLength);

        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);

        public NativeJob()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero || handle == new IntPtr(-1)) throw new InvalidOperationException();
            ExtendedLimitInformation limits = new ExtendedLimitInformation();
            limits.BasicLimitInformation.LimitFlags = 0x00002000;
            int size = Marshal.SizeOf(typeof(ExtendedLimitInformation));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(limits, buffer, false);
                if (!SetInformationJobObject(handle, 9, buffer, (uint)size)) throw new InvalidOperationException();
            }
            catch
            {
                CloseHandle(handle);
                handle = IntPtr.Zero;
                throw;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        public bool AssignHandle(IntPtr processHandle)
        {
            return !disposed && processHandle != IntPtr.Zero && AssignProcessToJobObject(handle, processHandle);
        }

        public bool Terminate()
        {
            return !disposed && TerminateJobObject(handle, 1);
        }

        public bool IsEmpty()
        {
            if (disposed) return false;
            int size = Marshal.SizeOf(typeof(BasicAccountingInformation));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (!QueryInformationJobObject(handle, 1, buffer, (uint)size, IntPtr.Zero)) return false;
                BasicAccountingInformation info = (BasicAccountingInformation)Marshal.PtrToStructure(buffer, typeof(BasicAccountingInformation));
                return info.ActiveProcesses == 0;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            if (handle != IntPtr.Zero)
            {
                CloseHandle(handle);
                handle = IntPtr.Zero;
            }
        }
    }

    public sealed class SuspendedProcess : IDisposable
    {
        private const uint CreateSuspended = 0x00000004;
        private const uint CreateNoWindow = 0x08000000;
        private const uint HandleFlagInherit = 0x00000001;
        private const uint StartfUseStdHandles = 0x00000100;
        private const uint WaitObject0 = 0x00000000;
        private const uint WaitTimeout = 0x00000102;
        private const uint Infinite = 0xffffffff;
        private const int StdInputHandle = -10;

        private IntPtr processHandle;
        private IntPtr threadHandle;
        private IntPtr stdoutReadHandle;
        private IntPtr stderrReadHandle;
        private StreamReader standardOutput;
        private StreamReader standardError;
        private bool disposed;

        [StructLayout(LayoutKind.Sequential)]
        private struct SecurityAttributes
        {
            public int Length;
            public IntPtr SecurityDescriptor;
            public int InheritHandle;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct StartupInfo
        {
            public int Size;
            public string Reserved;
            public string Desktop;
            public string Title;
            public uint X;
            public uint Y;
            public uint XSize;
            public uint YSize;
            public uint XCountChars;
            public uint YCountChars;
            public uint FillAttribute;
            public uint Flags;
            public short ShowWindow;
            public short Reserved2Count;
            public IntPtr Reserved2;
            public IntPtr StandardInput;
            public IntPtr StandardOutput;
            public IntPtr StandardError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessInformation
        {
            public IntPtr Process;
            public IntPtr Thread;
            public uint ProcessId;
            public uint ThreadId;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, ref SecurityAttributes attributes, int size);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcess(
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref StartupInfo startupInfo,
            out ProcessInformation processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr thread);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(IntPtr process, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GetStdHandle(int standardHandle);

        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);

        public SuspendedProcess()
        {
        }

        public bool Created { get { return !disposed && processHandle != IntPtr.Zero; } }

        public void Create(string commandLine)
        {
            if (disposed || Created || String.IsNullOrWhiteSpace(commandLine)) throw new InvalidOperationException();

            IntPtr stdoutRead = IntPtr.Zero;
            IntPtr stdoutWrite = IntPtr.Zero;
            IntPtr stderrRead = IntPtr.Zero;
            IntPtr stderrWrite = IntPtr.Zero;
            ProcessInformation processInformation = new ProcessInformation();
            SecurityAttributes attributes = new SecurityAttributes();
            attributes.Length = Marshal.SizeOf(typeof(SecurityAttributes));
            attributes.InheritHandle = 1;

            try
            {
                if (!CreatePipe(out stdoutRead, out stdoutWrite, ref attributes, 0)) throw new InvalidOperationException();
                if (!SetHandleInformation(stdoutRead, HandleFlagInherit, 0)) throw new InvalidOperationException();
                if (!CreatePipe(out stderrRead, out stderrWrite, ref attributes, 0)) throw new InvalidOperationException();
                if (!SetHandleInformation(stderrRead, HandleFlagInherit, 0)) throw new InvalidOperationException();

                StartupInfo startupInfo = new StartupInfo();
                startupInfo.Size = Marshal.SizeOf(typeof(StartupInfo));
                startupInfo.Flags = StartfUseStdHandles;
                startupInfo.StandardInput = GetStdHandle(StdInputHandle);
                startupInfo.StandardOutput = stdoutWrite;
                startupInfo.StandardError = stderrWrite;

                if (!CreateProcess(
                    null,
                    new StringBuilder(commandLine),
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    CreateSuspended | CreateNoWindow,
                    IntPtr.Zero,
                    null,
                    ref startupInfo,
                    out processInformation)) throw new InvalidOperationException();

                processHandle = processInformation.Process;
                threadHandle = processInformation.Thread;
                processInformation.Process = IntPtr.Zero;
                processInformation.Thread = IntPtr.Zero;

                stdoutReadHandle = stdoutRead;
                stdoutRead = IntPtr.Zero;
                stderrReadHandle = stderrRead;
                stderrRead = IntPtr.Zero;
                CloseIfValid(ref stdoutWrite);
                CloseIfValid(ref stderrWrite);
            }
            catch
            {
                CloseIfValid(ref stdoutRead);
                CloseIfValid(ref stdoutWrite);
                CloseIfValid(ref stderrRead);
                CloseIfValid(ref stderrWrite);
                if (processInformation.Process != IntPtr.Zero)
                {
                    processHandle = processInformation.Process;
                    threadHandle = processInformation.Thread;
                    processInformation.Process = IntPtr.Zero;
                    processInformation.Thread = IntPtr.Zero;
                }
                throw;
            }
        }

        public void InitializeReaders()
        {
            if (!Created || standardOutput != null || standardError != null) throw new InvalidOperationException();
            standardOutput = NewReader(ref stdoutReadHandle);
            standardError = NewReader(ref stderrReadHandle);
        }

        public IntPtr ProcessHandle { get { return disposed ? IntPtr.Zero : processHandle; } }

        public bool Resume()
        {
            return !disposed && threadHandle != IntPtr.Zero && ResumeThread(threadHandle) != Infinite;
        }

        public Task<string> ReadStandardOutputToEndAsync()
        {
            if (disposed || standardOutput == null) throw new ObjectDisposedException(GetType().FullName);
            return standardOutput.ReadToEndAsync();
        }

        public Task<string> ReadStandardErrorToEndAsync()
        {
            if (disposed || standardError == null) throw new ObjectDisposedException(GetType().FullName);
            return standardError.ReadToEndAsync();
        }

        public bool WaitForExit(int milliseconds)
        {
            if (disposed || processHandle == IntPtr.Zero || milliseconds < 0) return false;
            return WaitForSingleObject(processHandle, (uint)milliseconds) == WaitObject0;
        }

        public bool HasExited
        {
            get { return !disposed && processHandle != IntPtr.Zero && WaitForSingleObject(processHandle, 0) == WaitObject0; }
        }

        public int ExitCode
        {
            get
            {
                uint exitCode;
                if (!HasExited || !GetExitCodeProcess(processHandle, out exitCode)) throw new InvalidOperationException();
                return unchecked((int)exitCode);
            }
        }

        public bool TerminateAndWait(int milliseconds)
        {
            if (HasExited) return true;
            if (disposed || processHandle == IntPtr.Zero || milliseconds < 0) return false;
            if (!TerminateProcess(processHandle, 1) && !HasExited) return false;
            return WaitForExit(milliseconds);
        }

        private static StreamReader NewReader(ref IntPtr pipe)
        {
            SafeFileHandle safeHandle = new SafeFileHandle(pipe, true);
            pipe = IntPtr.Zero;
            FileStream stream = new FileStream(safeHandle, FileAccess.Read, 4096, false);
            return new StreamReader(stream, Encoding.UTF8, true, 4096);
        }

        private static void CloseIfValid(ref IntPtr handle)
        {
            if (handle == IntPtr.Zero || handle == new IntPtr(-1)) return;
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            if (standardOutput != null) standardOutput.Dispose();
            if (standardError != null) standardError.Dispose();
            CloseIfValid(ref stdoutReadHandle);
            CloseIfValid(ref stderrReadHandle);
            CloseIfValid(ref threadHandle);
            CloseIfValid(ref processHandle);
        }
    }
}
'@
        Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
    }
    return New-Object ChengyeOA.LocalPreproduction.NativeJob
}

function Invoke-LocalPreproductionNative {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$FilePath,
        [Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Arguments,
        [ValidateRange(1, 600000)][int]$TimeoutMilliseconds = 30000,
        [scriptblock]$TestOperation,
        [scriptblock]$TestProcessSetupOperation,
        [scriptblock]$TestAssignmentOperation,
        [scriptblock]$TestTerminationOperation,
        [scriptblock]$TestTerminationState
    )

    $terminationConfirmed = $true
    $timedOut = $false
    try {
        if ($null -ne $TestOperation) {
            $captured = @(& $TestOperation `
                -FilePath $FilePath `
                -Arguments ([string[]]$Arguments) `
                -TimeoutMilliseconds $TimeoutMilliseconds *>&1)
            if ($captured.Count -ne 1) {
                throw 'INVALID_NATIVE_RESULT'
            }
            $raw = $captured[0]
            $rawKeys = @($raw.PSObject.Properties.Name | Sort-Object)
            if ($null -eq $raw -or
                ($rawKeys -join ',') -cne 'ExitCode,StdErr,StdOut' -or
                $raw.ExitCode -isnot [int] -or
                $raw.StdOut -isnot [System.Array] -or
                $raw.StdErr -isnot [System.Array] -or
                @($raw.StdOut | Where-Object { $_ -isnot [string] }).Count -ne 0 -or
                @($raw.StdErr | Where-Object { $_ -isnot [string] }).Count -ne 0) {
                throw 'INVALID_NATIVE_RESULT'
            }
            $exitCode = [int]$raw.ExitCode
            $lines = @($raw.StdOut | ForEach-Object { [string]$_ })
            if ($null -ne $TestTerminationState) {
                $stateResult = @(& $TestTerminationState *>&1)
                if ($stateResult.Count -ne 1 -or $stateResult[0] -isnot [bool]) {
                    throw 'INVALID_TERMINATION_STATE'
                }
                $terminationConfirmed = [bool]$stateResult[0]
            }
        }
        else {
            $serializedArguments = New-Object System.Collections.Generic.List[string]
            $serializedArguments.Add((ConvertTo-LocalNativeArgument -Value $FilePath))
            foreach ($argument in $Arguments) {
                $serializedArguments.Add((ConvertTo-LocalNativeArgument -Value ([string]$argument)))
            }
            $commandLine = @($serializedArguments) -join ' '
            $process = $null
            $containment = New-LocalNativeContainment
            $watch = [System.Diagnostics.Stopwatch]::StartNew()
            $standardOutput = ''
            $processCreated = $false
            $executionReleased = $false
            try {
                $process = New-Object ChengyeOA.LocalPreproduction.SuspendedProcess
                $process.Create($commandLine)
                $processCreated = $process.Created
                if ($null -ne $TestProcessSetupOperation) {
                    $setupResult = @(& $TestProcessSetupOperation *>&1)
                    if ($setupResult.Count -ne 0) {
                        throw 'INVALID_PROCESS_SETUP_RESULT'
                    }
                }
                $process.InitializeReaders()
                $assignmentAllowed = $true
                if ($null -ne $TestAssignmentOperation) {
                    $assignmentResult = @(& $TestAssignmentOperation *>&1)
                    if ($assignmentResult.Count -ne 1 -or $assignmentResult[0] -isnot [bool]) {
                        throw 'INVALID_ASSIGNMENT_RESULT'
                    }
                    $assignmentAllowed = [bool]$assignmentResult[0]
                }
                if (-not $assignmentAllowed -or -not $containment.AssignHandle($process.ProcessHandle)) {
                    throw 'NATIVE_CONTAINMENT_FAILED'
                }
                if (-not $process.Resume()) {
                    throw 'NATIVE_RESUME_FAILED'
                }
                $executionReleased = $true
                $stdoutTask = $process.ReadStandardOutputToEndAsync()
                $stderrTask = $process.ReadStandardErrorToEndAsync()
                $terminationReserve = [math]::Min(1000, [math]::Max(50, [int][math]::Floor($TimeoutMilliseconds / 2)))
                $remaining = [math]::Max(1, $TimeoutMilliseconds - $terminationReserve - [int]$watch.ElapsedMilliseconds)
                if (-not $process.WaitForExit($remaining)) {
                    $timedOut = $true
                }
                if (-not $timedOut) {
                    $remaining = [math]::Max(1, $TimeoutMilliseconds - $terminationReserve - [int]$watch.ElapsedMilliseconds)
                    if (-not [System.Threading.Tasks.Task]::WaitAll(@($stdoutTask, $stderrTask), $remaining)) {
                        $timedOut = $true
                    }
                }
                if (-not $timedOut) {
                    $naturalExitDeadline = $TimeoutMilliseconds - $terminationReserve
                    while (-not $containment.IsEmpty() -and $watch.ElapsedMilliseconds -lt $naturalExitDeadline) {
                        Start-Sleep -Milliseconds 5
                    }
                    if (-not $containment.IsEmpty()) {
                        $timedOut = $true
                    }
                }
                if ($timedOut) {
                    $terminationRequested = $false
                    if ($null -ne $TestTerminationOperation) {
                        $terminationResult = @(& $TestTerminationOperation *>&1)
                        if ($terminationResult.Count -eq 1 -and $terminationResult[0] -is [bool]) {
                            $terminationRequested = [bool]$terminationResult[0]
                        }
                    }
                    else {
                        $terminationRequested = $containment.Terminate()
                    }
                    $terminationConfirmed = $false
                    if ($terminationRequested) {
                        $terminationWatch = [System.Diagnostics.Stopwatch]::StartNew()
                        while ($terminationWatch.ElapsedMilliseconds -lt 1000) {
                            if ($containment.IsEmpty()) {
                                $terminationConfirmed = $true
                                break
                            }
                            Start-Sleep -Milliseconds 5
                        }
                        $terminationWatch.Stop()
                    }
                }
                if (-not $timedOut) {
                    $standardOutput = $stdoutTask.Result
                    $exitCode = [int]$process.ExitCode
                }
                else {
                    $exitCode = 1
                }
            }
            catch {
                if ($null -ne $process -and $process.Created -and -not $executionReleased) {
                    $terminationConfirmed = $false
                    try {
                        $terminationConfirmed = [bool]$process.TerminateAndWait(1000)
                    }
                    catch {
                        $terminationConfirmed = $false
                    }
                    if ($null -ne $TestTerminationState) {
                        try {
                            $stateResult = @(& $TestTerminationState *>&1)
                            if ($stateResult.Count -ne 1 -or $stateResult[0] -isnot [bool]) {
                                $terminationConfirmed = $false
                            }
                            else {
                                $terminationConfirmed = $terminationConfirmed -and [bool]$stateResult[0]
                            }
                        }
                        catch {
                            $terminationConfirmed = $false
                        }
                    }
                }
                throw
            }
            finally {
                if ($null -ne $containment) {
                    $containment.Dispose()
                }
                if ($processCreated -and $timedOut) {
                    $primaryExitConfirmed = $process.WaitForExit(1000)
                    if ($terminationConfirmed -and -not $primaryExitConfirmed) {
                        $terminationConfirmed = $false
                    }
                }
                $watch.Stop()
                if ($null -ne $process) {
                    $process.Dispose()
                }
            }
            $lines = @($standardOutput.Split([char[]]"`r`n", [System.StringSplitOptions]::RemoveEmptyEntries))
        }

        return [pscustomobject][ordered]@{
            Succeeded = ($exitCode -eq 0 -and $terminationConfirmed)
            ExitCode = $exitCode
            TimedOut = $timedOut
            TerminationConfirmed = $terminationConfirmed
            Lines = @($lines)
        }
    }
    catch {
        return [pscustomobject][ordered]@{
            Succeeded = $false
            ExitCode = 1
            TimedOut = $false
            TerminationConfirmed = $terminationConfirmed
            Lines = @()
        }
    }
}

function Test-LocalPathWithoutReparsePoint {
    param(
        [Parameter(Mandatory)][string]$RootPath,
        [Parameter(Mandatory)][string]$LeafPath
    )

    $root = [System.IO.Path]::GetFullPath($RootPath).TrimEnd([char[]]'\/')
    $leaf = [System.IO.Path]::GetFullPath($LeafPath)
    if (-not $leaf.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $false
    }
    $pathRoot = [System.IO.Path]::GetPathRoot($leaf)
    if ([string]::IsNullOrWhiteSpace($pathRoot) -or -not (Test-Path -LiteralPath $pathRoot -PathType Container)) {
        return $false
    }
    $rootItem = Get-Item -LiteralPath $pathRoot -Force -ErrorAction Stop
    if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        return $false
    }
    $relative = $leaf.Substring($pathRoot.Length).TrimStart([char[]]'\/')
    $current = $pathRoot
    foreach ($component in $relative.Split([char[]]'\/', [System.StringSplitOptions]::RemoveEmptyEntries)) {
        $current = [System.IO.Path]::Combine($current, $component)
        if (-not (Test-Path -LiteralPath $current)) {
            return $false
        }
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            return $false
        }
    }
    return $true
}

function New-LocalPreproductionComposeArguments {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowNull()][object]$Target,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$CommandArguments
    )

    try {
        $fixedProjectName = 'chengyeoa-local-preproduction'
        $repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
        $fixedBasePath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'LayerManage\law-firm-system\infra\postgres\compose.yml'))
        $fixedOverridePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'local-preproduction.compose.override.yml'))
        if ($null -eq $Target -or
            $null -eq $Target.PSObject.Properties['ProjectName'] -or
            $null -eq $Target.PSObject.Properties['ComposeFiles'] -or
            [string]$Target.ProjectName -cne $fixedProjectName) {
            throw 'INVALID_TARGET'
        }
        $composeFiles = @($Target.ComposeFiles)
        if ($composeFiles.Count -ne 2 -or
            -not ([string]$composeFiles[0]).Equals($fixedBasePath, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not ([string]$composeFiles[1]).Equals($fixedOverridePath, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'INVALID_TARGET'
        }
        foreach ($argument in @($CommandArguments)) {
            $value = [string]$argument
            if ($value.StartsWith('-p', [System.StringComparison]::OrdinalIgnoreCase) -or
                $value.StartsWith('-f', [System.StringComparison]::OrdinalIgnoreCase) -or
                $value.Equals('--project-name', [System.StringComparison]::OrdinalIgnoreCase) -or
                $value.StartsWith('--project-name=', [System.StringComparison]::OrdinalIgnoreCase) -or
                $value.Equals('--file', [System.StringComparison]::OrdinalIgnoreCase) -or
                $value.StartsWith('--file=', [System.StringComparison]::OrdinalIgnoreCase)) {
                throw 'INVALID_TARGET'
            }
        }

        return [string[]]@(
            'compose', '-p', $fixedProjectName,
            '-f', $fixedBasePath,
            '-f', $fixedOverridePath
        ) + [string[]]@($CommandArguments)
    }
    catch {
        throw 'COMPOSE_TARGET_INVALID'
    }
}

function Get-LocalPreproductionComposeTarget {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$ComposePath,
        [scriptblock]$TestOperation,
        [scriptblock]$TestTerminationState
    )

    try {
        $fixedProjectName = 'chengyeoa-local-preproduction'
        $fixedOverridePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'local-preproduction.compose.override.yml'))
        if (-not [System.IO.Path]::IsPathRooted($ComposePath) -or $ComposePath -match '^[^\\/:]+::') {
            throw 'INVALID_TARGET'
        }
        $repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
        $projectPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'LayerManage\law-firm-system'))
        $canonicalPath = [System.IO.Path]::GetFullPath((Join-Path $projectPath 'infra\postgres\compose.yml'))
        $candidatePath = [System.IO.Path]::GetFullPath($ComposePath)
        if (-not $candidatePath.Equals($canonicalPath, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $candidatePath -PathType Leaf) -or
            -not (Test-LocalPathWithoutReparsePoint -RootPath $repositoryRoot -LeafPath $candidatePath) -or
            -not (Test-Path -LiteralPath $fixedOverridePath -PathType Leaf) -or
            -not (Test-LocalPathWithoutReparsePoint -RootPath $repositoryRoot -LeafPath $fixedOverridePath)) {
            throw 'INVALID_TARGET'
        }
    }
    catch {
        throw 'COMPOSE_TARGET_INVALID'
    }

    $targetProjectName = $fixedProjectName
    $targetComposeFiles = [string[]]@($canonicalPath, $fixedOverridePath)
    $targetServiceCount = 1
    $targetVolumeCount = 1
    $target = New-Object psobject
    $target | Add-Member -MemberType ScriptProperty -Name ProjectName -Value ({ return $targetProjectName }.GetNewClosure())
    $target | Add-Member -MemberType ScriptProperty -Name ComposeFiles -Value ({ return [string[]]@($targetComposeFiles) }.GetNewClosure())
    $target | Add-Member -MemberType ScriptProperty -Name ServiceCount -Value ({ return $targetServiceCount }.GetNewClosure())
    $target | Add-Member -MemberType ScriptProperty -Name VolumeCount -Value ({ return $targetVolumeCount }.GetNewClosure())

    $services = Invoke-LocalPreproductionNative `
        -FilePath 'docker' `
        -Arguments (New-LocalPreproductionComposeArguments -Target $target -CommandArguments @('config', '--services')) `
        -TestOperation $TestOperation `
        -TestTerminationState $TestTerminationState
    if (-not $services.TerminationConfirmed) {
        throw 'NATIVE_TERMINATION_UNCONFIRMED'
    }
    if (-not $services.Succeeded) {
        throw 'COMPOSE_METADATA_FAILED'
    }
    $serviceLines = @($services.Lines | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_.Length -gt 0 })
    if ($serviceLines.Count -ne 1 -or $serviceLines[0] -cne 'postgres') {
        throw 'COMPOSE_TARGET_INVALID'
    }
    $volumes = Invoke-LocalPreproductionNative `
        -FilePath 'docker' `
        -Arguments (New-LocalPreproductionComposeArguments -Target $target -CommandArguments @('config', '--volumes')) `
        -TestOperation $TestOperation `
        -TestTerminationState $TestTerminationState
    if (-not $volumes.TerminationConfirmed) {
        throw 'NATIVE_TERMINATION_UNCONFIRMED'
    }
    if (-not $volumes.Succeeded) {
        throw 'COMPOSE_METADATA_FAILED'
    }
    $volumeLines = @($volumes.Lines | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_.Length -gt 0 })
    if ($volumeLines.Count -ne 1 -or $volumeLines[0] -cne 'chengye_postgres_data') {
        throw 'COMPOSE_TARGET_INVALID'
    }

    return $target
}

Export-ModuleMember -Function `
    New-LocalPreproductionMaterial, `
    Protect-LocalPreproductionBundle, `
    Unprotect-LocalPreproductionBundle, `
    Test-LocalPreproductionEnvironment, `
    Compare-EventPreflightSnapshot, `
    Invoke-LocalPreproductionNative, `
    Get-LocalPreproductionComposeTarget, `
    New-LocalPreproductionComposeArguments
