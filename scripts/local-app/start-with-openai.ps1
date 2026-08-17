$ErrorActionPreference = 'Stop'

$secureKey = Read-Host 'Pegá una API key NUEVA de OpenAI' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)

try {
  $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) {
    throw 'La clave no puede estar vacía.'
  }
  npm run dev:filesystem
}
finally {
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
}
