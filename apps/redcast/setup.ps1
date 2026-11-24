# Setup: runs every time START.bat runs. Detects this PC's graphics card and driver, installs the
# app runtime (Electron) and the ffmpeg build that matches this PC. Quick when nothing has changed.
param([switch]$FfmpegOnly)   # Red Launcher passes -FfmpegOnly: it supplies the app runtime itself
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$ProgressPreference = 'SilentlyContinue'

$electronVer = '33.2.0'
$electronUrl = "https://github.com/electron/electron/releases/download/v$electronVer/electron-v$electronVer-win32-x64.zip"
$gh = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
$gyan = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
$builds = @{
    'n7.1' = @("$gh/ffmpeg-n7.1-latest-win64-gpl-7.1.zip", $gyan)
    'n6.1' = @("$gh/ffmpeg-n6.1-latest-win64-gpl-6.1.zip", "$gh/ffmpeg-n7.1-latest-win64-gpl-7.1.zip", $gyan)
}

$runtime     = Join-Path $root 'runtime'
$tmp         = Join-Path $runtime 'tmp'
$electronDir = Join-Path $runtime 'electron'
$electronExe = Join-Path $electronDir 'electron.exe'
$binDir      = Join-Path $root 'bin'
$ffmpegExe   = Join-Path $binDir 'ffmpeg.exe'
$markerPath  = Join-Path $binDir 'ffmpeg-build.txt'

function Download($url, $dest) {
    for ($i = 1; $i -le 3; $i++) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
            if ((Get-Item $dest).Length -gt 1MB) { return }
            throw 'Download was too small'
        } catch {
            Write-Host "   Attempt $i failed: $($_.Exception.Message)"
            if ($i -eq 3) { throw }
            Start-Sleep -Seconds 3
        }
    }
}

function Unzip($zip, $dest) {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
    if ($tar) {
        & tar.exe -xf $zip -C $dest
        if ($LASTEXITCODE -eq 0) { return }
    }
    Expand-Archive -Path $zip -DestinationPath $dest -Force
}

# ---- Detect the graphics card and driver ----
function Get-GpuInfo {
    $info = @{ Vendor = 'unknown'; Name = 'unknown'; Driver = 0.0; All = '' }
    $gpus = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name })
    $info.All = ($gpus | ForEach-Object { $_.Name }) -join ' + '
    $nv = $gpus | Where-Object { $_.Name -match 'NVIDIA' } | Select-Object -First 1
    $amd = $gpus | Where-Object { $_.Name -match 'AMD|Radeon' } | Select-Object -First 1
    $intel = $gpus | Where-Object { $_.Name -match 'Intel' } | Select-Object -First 1
    if ($nv) { $info.Vendor = 'nvidia'; $pick = $nv }
    elseif ($amd) { $info.Vendor = 'amd'; $pick = $amd }
    elseif ($intel) { $info.Vendor = 'intel'; $pick = $intel }
    else { return $info }
    $info.Name = $pick.Name
    if ($info.Vendor -eq 'nvidia') {
        $ver = $null
        $smiCmd = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
        $smi = if ($smiCmd) { $smiCmd.Source } else { Join-Path $env:ProgramFiles 'NVIDIA Corporation\NVSMI\nvidia-smi.exe' }
        if (Test-Path $smi) {
            try { $ver = (& $smi --query-gpu=driver_version --format=csv,noheader | Select-Object -First 1).Trim() } catch {}
        }
        if (-not $ver -and $pick.DriverVersion) {
            # Windows reports e.g. 32.0.15.7602 which means NVIDIA driver 576.02
            $digits = ($pick.DriverVersion -replace '\.', '')
            if ($digits.Length -ge 5) {
                $last5 = $digits.Substring($digits.Length - 5)
                $ver = $last5.Substring(0, 3) + '.' + $last5.Substring(3, 2)
            }
        }
        if ($ver) { $info.Driver = [double]::Parse($ver, [Globalization.CultureInfo]::InvariantCulture) }
    }
    return $info
}

function Choose-Build($gpu) {
    if ($gpu.Vendor -eq 'nvidia' -and $gpu.Driver -gt 0) {
        if ($gpu.Driver -ge 551.76) { return 'n7.1' }
        return 'n6.1'
    }
    return 'n7.1'
}

try {
    New-Item -ItemType Directory -Force -Path $tmp, $binDir | Out-Null
    if (Test-Path (Join-Path $binDir 'ffmpeg-build-n7.1.txt')) { Remove-Item (Join-Path $binDir 'ffmpeg-build-n7.1.txt') -Force }

    # ---- Graphics detection ----
    $gpu = $null; $build = 'n7.1'
    try {
        $gpu = Get-GpuInfo
        $build = Choose-Build $gpu
        Write-Host ''
        Write-Host "This PC's graphics: $($gpu.All)"
        if ($gpu.Vendor -eq 'nvidia') {
            Write-Host "  Using: $($gpu.Name), NVIDIA driver $($gpu.Driver)"
            if ($gpu.Driver -gt 0 -and $gpu.Driver -lt 531.61) {
                Write-Host '  NOTE: this NVIDIA driver is quite old. The graphics card encoder may not work.' -ForegroundColor Yellow
                Write-Host '        Update the driver from nvidia.com for best results.' -ForegroundColor Yellow
            }
        } elseif ($gpu.Vendor -ne 'unknown') {
            Write-Host "  Using: $($gpu.Name) ($($gpu.Vendor.ToUpper()) hardware encoder will be tested)"
        } else {
            Write-Host '  Could not identify the graphics card. The CPU encoder will be available.'
        }
    } catch {
        Write-Host "Could not detect graphics ($($_.Exception.Message)). Using the default ffmpeg."
    }
    $signature = "$build|$($gpu.Vendor)|$($gpu.Driver)"

    # ---- Electron (app runtime) ----
    # It must have electron.exe AND its own ffmpeg.dll AND its resources folder. If any is missing, reinstall it.
    $dllPath = Join-Path $electronDir 'ffmpeg.dll'
    $electronOk = (Test-Path $electronExe) -and (Test-Path $dllPath) -and (Test-Path (Join-Path $electronDir 'resources'))
    if (-not $FfmpegOnly -and -not $electronOk) {
        if (Test-Path $electronExe) {
            Write-Host ''
            Write-Host 'The app runtime is damaged (a file is missing, for example ffmpeg.dll). Reinstalling it...' -ForegroundColor Yellow
        }
        Write-Host ''
        Write-Host '[1/2] Downloading the app runtime (about 110 MB)...'
        $z = Join-Path $tmp 'electron.zip'
        Download $electronUrl $z
        Write-Host '      Unpacking...'
        if (Test-Path $electronDir) { Remove-Item -Recurse -Force $electronDir }
        Unzip $z $electronDir
        Remove-Item $z -Force
        Start-Sleep -Seconds 2   # give antivirus a moment to finish scanning the new files
        if (-not (Test-Path $electronExe)) { throw 'electron.exe was not found after unpacking' }
        if (-not (Test-Path $dllPath)) {
            throw ('ffmpeg.dll is missing right after unpacking. Antivirus most likely removed it. ' +
                   'Open Windows Security > Virus and threat protection > Protection history, restore the quarantined ffmpeg.dll, ' +
                   'then add this whole folder under Manage settings > Exclusions, and run START.bat again.')
        }
    }

    # ---- ffmpeg that matches this PC ----
    $current = ''
    if (Test-Path $markerPath) { $current = (Get-Content $markerPath -TotalCount 1) }
    $needFfmpeg = (-not (Test-Path $ffmpegExe)) -or ($current -ne $signature)
    if ($needFfmpeg) {
        Write-Host ''
        Write-Host "[2/2] Getting the right ffmpeg for this PC (build $build, about 150 MB)..."
        if (Test-Path $ffmpegExe) { Remove-Item $ffmpegExe -Force }
        $z = Join-Path $tmp 'ffmpeg.zip'
        $got = $false
        foreach ($u in $builds[$build]) {
            try { Write-Host "      From $u"; Download $u $z; $got = $true; break }
            catch { Write-Host '      That source failed, trying the next one...' }
        }
        if (-not $got) { throw 'Could not download ffmpeg from any source' }
        Write-Host '      Unpacking (this can take a minute)...'
        $x = Join-Path $tmp 'ffmpeg'
        if (Test-Path $x) { Remove-Item -Recurse -Force $x }
        Unzip $z $x
        $found = Get-ChildItem -Path $x -Recurse -Filter ffmpeg.exe | Select-Object -First 1
        if (-not $found) { throw 'ffmpeg.exe was not found in the download' }
        Copy-Item $found.FullName $ffmpegExe -Force
        Set-Content -Path $markerPath -Value $signature
        Remove-Item $z -Force
        Remove-Item -Recurse -Force $x
    }

    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
    Write-Host ''
    Write-Host 'Ready. Starting the app...'
    exit 0
} catch {
    Write-Host ''
    Write-Host 'SETUP FAILED:' $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    Write-Host 'Check the internet connection and run START.bat again. If it keeps failing, do it by hand:'
    Write-Host "  1. Download: $electronUrl"
    Write-Host '     and unzip it so that this file exists: runtime\electron\electron.exe'
    Write-Host "  2. Download: $($builds['n7.1'][0])"
    Write-Host '     and copy ffmpeg.exe (from its bin folder) into the bin folder here.'
    exit 1
}
