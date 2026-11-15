# 关闭休眠与显示器超时，避免 Windows 一睡全员不可用。需管理员运行一次。
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0
powercfg /hibernate off
Write-Host "已关闭休眠。请同时关闭「睡眠」相关电源按钮动作。"
