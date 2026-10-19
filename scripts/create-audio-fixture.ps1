Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$destPath = "$PSScriptRoot\..\tests\fixtures\synthetic-voice-sample.wav"
$synth.SetOutputToWaveFile($destPath)
$synth.Speak("Lif rosak di tingkat tiga Blok A")
$synth.Dispose()
$size = (Get-Item $destPath).Length
Write-Host "Generated audio fixture: $destPath ($size bytes)"
