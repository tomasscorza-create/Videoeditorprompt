$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host 'Configuración permanente de ElevenLabs para las voces' -ForegroundColor Cyan
Write-Host 'Pegá la clave. El texto permanecerá oculto y no se guardará en el repositorio.'

$secureKey = Read-Host 'API key de ElevenLabs' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)

try {
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  if ([string]::IsNullOrWhiteSpace($plainKey) -or $plainKey.Length -lt 20) {
    throw 'La clave ingresada no parece válida.'
  }
  [Environment]::SetEnvironmentVariable('ELEVENLABS_API_KEY', $plainKey, 'User')
  Write-Host ''
  Write-Host 'Clave guardada para tu usuario de Windows.' -ForegroundColor Green
  Write-Host 'Reiniciá la aplicación para cargarla.'
}
finally {
  $plainKey = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
}
