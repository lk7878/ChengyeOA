# Harness user namespaces on Ubuntu

Every task must run inside bubblewrap, with independent network, PID and filesystem namespaces. A failed sandbox startup stops the task; there is no direct host fallback. Port 8090 belongs inside each task's network namespace, never on the host.

Ubuntu's `apparmor_restrict_unprivileged_userns=1` can allow user namespace creation but deny bubblewrap's loopback setup (`RTM_NEWADDR: Operation not permitted`). Check from the service context with `systemd-run --user --wait --pipe`, not only from an interactive terminal: they can have different AppArmor profiles.

`HARNESS_APPARMOR_PROFILE` optionally selects an already-installed AppArmor profile for the bubblewrap child via `aa-exec -p PROFILE -- bwrap ...`. It does not change the OA service's profile. The profile must explicitly allow `userns`. On the current desktop host, the existing `chatgpt` profile has that rule and is selected in `oa-smart-case.service.d/harness.conf`. On a dedicated server, the administrator should install a dedicated `oa-harness` profile granting userns and set that profile name. Do not disable the system-wide AppArmor restriction.

Verify after configuration:

```sh
systemd-run --user --wait --pipe --setenv=HARNESS_APPARMOR_PROFILE=PROFILE \
  --working-directory=/absolute/project/path \
  /absolute/node/bin/node --test case-service/test/isolation.test.js
```

The test starts two concurrent task environments, checks independent credentials/sessions, denies host filesystem access, and checks session persistence after restart. Startup diagnostics stay in each task's private `startup.log`; users receive a concise retry message.
