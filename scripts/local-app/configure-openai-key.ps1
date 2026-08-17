$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host 'Configuración permanente de OpenAI para el Director IA' -ForegroundColor Cyan
Write-Host 'Pegá una clave NUEVA. El texto permanecerá oculto.'

$secureKey = Read-Host 'API key de OpenAI' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)

try {
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  if ([string]::IsNullOrWhiteSpace($plainKey) -or $plainKey.Length -lt 20) {
    throw 'La clave ingresada no parece válida.'
  }

  [Environment]::SetEnvironmentVariable('OPENAI_API_KEY', $plainKey, 'User')
  Write-Host ''
  Write-Host 'Clave guardada para tu usuario de Windows.' -ForegroundColor Green
  Write-Host 'Desde ahora podés iniciar normalmente con: npm run dev:filesystem'
  Write-Host 'Cerrá cualquier servidor anterior antes de volver a abrir la aplicación.'
}
finally {
  $plainKey = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
}
