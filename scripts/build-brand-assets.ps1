param(
  [string]$SourcePath = ""
)

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $SourcePath) {
  $SourcePath = Join-Path $root "brand\relay-logo-source.png"
}

$assets = Join-Path $root "desktop\assets"
$markPath = Join-Path $assets "relay-mark.png"
$iconPath = Join-Path $assets "icon-source.png"
$source = [System.Drawing.Bitmap]::FromFile($SourcePath)

try {
  $minX = $source.Width
  $minY = $source.Height
  $maxX = -1
  $maxY = -1

  for ($y = 0; $y -lt $source.Height; $y += 1) {
    for ($x = 0; $x -lt $source.Width; $x += 1) {
      $pixel = $source.GetPixel($x, $y)
      if (($pixel.R + $pixel.G + $pixel.B) -lt 690) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }

  if ($maxX -lt $minX -or $maxY -lt $minY) {
    throw "No visible mark found in $SourcePath"
  }

  $margin = 18
  $left = [Math]::Max(0, $minX - $margin)
  $top = [Math]::Max(0, $minY - $margin)
  $right = [Math]::Min($source.Width - 1, $maxX + $margin)
  $bottom = [Math]::Min($source.Height - 1, $maxY + $margin)
  $mark = New-Object System.Drawing.Bitmap ($right - $left + 1), ($bottom - $top + 1), ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

  try {
    for ($y = 0; $y -lt $mark.Height; $y += 1) {
      for ($x = 0; $x -lt $mark.Width; $x += 1) {
        $pixel = $source.GetPixel($left + $x, $top + $y)
        $luma = [int](0.2126 * $pixel.R + 0.7152 * $pixel.G + 0.0722 * $pixel.B)
        $alpha = [Math]::Max(0, [Math]::Min(255, 255 - $luma))
        $mark.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, 0, 0, 0))
      }
    }

    $mark.Save($markPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $icon = New-Object System.Drawing.Bitmap 256, 256, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($icon)
      try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
        try {
          $shape.AddArc(12, 12, 64, 64, 180, 90)
          $shape.AddArc(180, 12, 64, 64, 270, 90)
          $shape.AddArc(180, 180, 64, 64, 0, 90)
          $shape.AddArc(12, 180, 64, 64, 90, 90)
          $shape.CloseFigure()
          $graphics.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 250, 249, 246))), $shape)
          $graphics.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 218, 216, 210), 2)), $shape)
        } finally {
          $shape.Dispose()
        }

        $targetWidth = 204
        $targetHeight = [int]($mark.Height * ($targetWidth / $mark.Width))
        $targetX = [int]((256 - $targetWidth) / 2)
        $targetY = [int]((256 - $targetHeight) / 2)
        $graphics.DrawImage($mark, $targetX, $targetY, $targetWidth, $targetHeight)
      } finally {
        $graphics.Dispose()
      }
      $icon.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $icon.Dispose()
    }
  } finally {
    $mark.Dispose()
  }
} finally {
  $source.Dispose()
}
