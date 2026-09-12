param(
    [int]$Port = 3030
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "Roblox AI — Escribe tu petición"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(620, 300)
$form.MinimumSize = New-Object System.Drawing.Size(500, 250)
$form.FormBorderStyle = "Sizable"
$form.MaximizeBox = $true
$form.MinimizeBox = $true

$title = New-Object System.Windows.Forms.Label
$title.Text = "Escribe tu petición"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(18, 15)
$form.Controls.Add($title)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = "El Bridge seguirá mostrando errores y logs en la consola."
$hint.ForeColor = [System.Drawing.Color]::DimGray
$hint.AutoSize = $true
$hint.Location = New-Object System.Drawing.Point(20, 48)
$form.Controls.Add($hint)

$input = New-Object System.Windows.Forms.TextBox
$input.Multiline = $true
$input.ScrollBars = "Vertical"
$input.AcceptsReturn = $true
$input.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$input.Location = New-Object System.Drawing.Point(20, 78)
$input.Size = New-Object System.Drawing.Size(564, 125)
$input.Anchor = "Top,Bottom,Left,Right"
$form.Controls.Add($input)

$send = New-Object System.Windows.Forms.Button
$send.Text = "Enviar"
$send.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$send.Size = New-Object System.Drawing.Size(110, 35)
$send.Location = New-Object System.Drawing.Point(474, 215)
$send.Anchor = "Bottom,Right"
$form.Controls.Add($send)

$status = New-Object System.Windows.Forms.Label
$status.Text = "Listo."
$status.ForeColor = [System.Drawing.Color]::DimGray
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(20, 224)
$status.Anchor = "Bottom,Left"
$form.Controls.Add($status)

function Send-Request {
    $message = $input.Text.Trim()
    if ([string]::IsNullOrWhiteSpace($message)) {
        $status.Text = "Escribe una petición primero."
        $status.ForeColor = [System.Drawing.Color]::DarkOrange
        return
    }

    try {
        $json = @{ message = $message } | ConvertTo-Json -Compress
        $response = Invoke-WebRequest `
            -Uri ("http://127.0.0.1:{0}/ask" -f $Port) `
            -Method Post `
            -ContentType "application/json; charset=utf-8" `
            -Body $json `
            -TimeoutSec 10

        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
            $input.Clear()
            $status.Text = "Petición enviada."
            $status.ForeColor = [System.Drawing.Color]::ForestGreen
        } else {
            $status.Text = "El Bridge devolvió HTTP $($response.StatusCode)."
            $status.ForeColor = [System.Drawing.Color]::Firebrick
        }
    }
    catch {
        $status.Text = "No se pudo conectar con el Bridge."
        $status.ForeColor = [System.Drawing.Color]::Firebrick
        [System.Windows.Forms.MessageBox]::Show(
            "No se pudo enviar la petición.`r`n`r`n$($_.Exception.Message)",
            "Roblox AI Bridge",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}

$send.Add_Click({ Send-Request })
$form.AcceptButton = $send

$form.Add_Shown({
    $input.Focus()
})

[void]$form.ShowDialog()
