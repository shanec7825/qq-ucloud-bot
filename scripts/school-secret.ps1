param([ValidateSet('protect', 'unprotect')][string]$Mode)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$taskValue = [Console]::In.ReadToEnd()
$taskScope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$taskEntropy = [Text.Encoding]::UTF8.GetBytes('slyra-school-session-v1')
if ($Mode -eq 'protect') {
    $taskBytes = [Text.Encoding]::UTF8.GetBytes($taskValue)
    $taskEncrypted = [System.Security.Cryptography.ProtectedData]::Protect($taskBytes, $taskEntropy, $taskScope)
    [Console]::Out.Write([Convert]::ToBase64String($taskEncrypted))
} else {
    $taskBytes = [Convert]::FromBase64String($taskValue)
    $taskDecrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($taskBytes, $taskEntropy, $taskScope)
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($taskDecrypted))
}
