#Requires AutoHotkey v2.0
#SingleInstance Force
#NoTrayIcon
Persistent
SendMode "Input"
SetWorkingDir A_ScriptDir

PORT := 8765
TIMEOUT := 45
global BUSY := false
global POLLING := false
global AUTO_LANG := ""
global AUTO_PROC := ""
global LAST_EXTERNAL_PROC := ""
global RUNTIME_MESSAGE := ""
global CONTROL_ID := 0
global BADGE := ""
global HIGHLIGHT := false
global HL_BADGE := ""
global READER := ""
global TOAST := ""
global LAST_SEL := ""
global DRAG_X := 0, DRAG_Y := 0
global SERVER_PID := 0

OnExit(CloseApp)
StartServer()
TrackActiveWindow()
PushRuntime()
SetTimer TrackActiveWindow, 250
SetTimer PollControl, 350
SetTimer RefreshModeBadge, 500

^!k:: Outgoing("ko")
^!j:: Outgoing("ja")
^!f:: Outgoing("fr")
^!e:: Incoming()
^!1:: ToggleAuto("ko")
^!2:: ToggleAuto("ja")
^!3:: ToggleAuto("fr")
^!0:: TurnAutoOff()
^!h:: SetHighlight(!HIGHLIGHT)
^!.:: ExitApp()

#HotIf HIGHLIGHT
~LButton:: MarkDragStart()
~LButton Up:: MaybeReadSelection()
#HotIf

#HotIf AutoArmed()
Enter:: AutoSend()
#HotIf

IsOwnProcess(proc) {
    own := Map(
        "Relay.exe", true,
        "Relay Helper.exe", true,
        "AutoHotkey64.exe", true,
        "AutoHotkey32.exe", true,
        "electron.exe", true
    )
    return own.Has(proc)
}

TrackActiveWindow(*) {
    global LAST_EXTERNAL_PROC, RUNTIME_MESSAGE
    try proc := WinGetProcessName("A")
    catch
        return
    if (proc == "" || IsOwnProcess(proc) || proc == LAST_EXTERNAL_PROC)
        return
    LAST_EXTERNAL_PROC := proc
    RUNTIME_MESSAGE := ""
    PushRuntime()
}

CurrentTarget() {
    global LAST_EXTERNAL_PROC
    try proc := WinGetProcessName("A")
    catch
        return LAST_EXTERNAL_PROC
    if !IsOwnProcess(proc) {
        LAST_EXTERNAL_PROC := proc
        return proc
    }
    return LAST_EXTERNAL_PROC
}

PollControl(*) {
    global POLLING, CONTROL_ID
    if POLLING
        return
    POLLING := true
    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.Open("GET", "http://127.0.0.1:" PORT "/api/control?after=" CONTROL_ID, true)
        req.Send()
        if !req.WaitForResponse(1) || req.Status != 200
            return
        line := Trim(ReadUtf8(req), " `t`r`n")
        if (line == "")
            return
        parts := StrSplit(line, "`t")
        if (parts.Length < 2)
            return
        CONTROL_ID := Integer(parts[1])
        action := parts[2]
        value := parts.Length >= 3 ? parts[3] : ""
        if (action == "auto")
            SetAuto(value, CurrentTarget())
        else if (action == "auto-off")
            TurnAutoOff()
        else if (action == "highlight")
            SetHighlight(value == "on")
    } catch {
    } finally {
        POLLING := false
    }
}

PushRuntime() {
    global AUTO_LANG, AUTO_PROC, HIGHLIGHT, LAST_EXTERNAL_PROC, RUNTIME_MESSAGE, PORT
    body := '{"autoLang":' JsonStr(AUTO_LANG)
        . ',"autoProc":' JsonStr(AUTO_PROC)
        . ',"highlight":' (HIGHLIGHT ? "true" : "false")
        . ',"targetProc":' JsonStr(LAST_EXTERNAL_PROC)
        . ',"message":' JsonStr(RUNTIME_MESSAGE) '}'
    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.Open("POST", "http://127.0.0.1:" PORT "/api/runtime", false)
        req.SetRequestHeader("Content-Type", "application/json; charset=utf-8")
        req.Send(body)
    }
}

LanguageName(lang) {
    return Map("ko", "Korean", "ja", "Japanese", "fr", "French").Get(lang, lang)
}

MarkDragStart() {
    global DRAG_X, DRAG_Y
    MouseGetPos &DRAG_X, &DRAG_Y
}

MaybeReadSelection() {
    global DRAG_X, DRAG_Y, BUSY, LAST_SEL, READER
    if BUSY
        return

    MouseGetPos &x, &y
    dragged := Abs(x - DRAG_X) > 4 || Abs(y - DRAG_Y) > 4
    doubled := !dragged && A_TimeSincePriorHotkey >= 0 && A_TimeSincePriorHotkey < 400
    if (!dragged && !doubled)
        return

    if IsObject(READER) {
        try {
            if WinActive("ahk_id " READER.Hwnd)
                return
        }
    }

    BUSY := true
    try {
        saved := ClipboardAll()
        A_Clipboard := ""
        Send "^c"
        if !ClipWait(0.4) {
            Restore(saved)
            return
        }

        src := Trim(A_Clipboard)
        Restore(saved)
        if (StrLen(src) < 2 || StrLen(src) > 800 || src == LAST_SEL)
            return
        LAST_SEL := src
        ShowToast("reading…", "info", 0)
        result := Ask("en", src)
        HideToast()
        if result.ok
            ShowReader(src, result.text)
        else
            ShowToast(result.text, "error", 3200)
    } finally {
        BUSY := false
    }
}

SetHighlight(on) {
    global HIGHLIGHT, LAST_SEL, RUNTIME_MESSAGE
    HIGHLIGHT := on
    LAST_SEL := ""
    RUNTIME_MESSAGE := ""
    if HIGHLIGHT {
        ShowHighlightBadge()
        ShowToast("highlight to read is on", "info", 1700)
    } else {
        HideHighlightBadge()
        ShowToast("highlight to read is off", "info", 1400)
    }
    PushRuntime()
}

AutoArmed() {
    global AUTO_LANG, AUTO_PROC
    if (AUTO_LANG == "")
        return false
    try return WinActive("ahk_exe " AUTO_PROC)
    return false
}

ToggleAuto(lang, target := "") {
    global AUTO_LANG, AUTO_PROC
    if (target == "")
        target := CurrentTarget()
    if (lang == AUTO_LANG && target == AUTO_PROC) {
        TurnAutoOff()
        return
    }

    SetAuto(lang, target)
}

SetAuto(lang, target := "") {
    global AUTO_LANG, AUTO_PROC, RUNTIME_MESSAGE
    if (target == "")
        target := CurrentTarget()
    if (target == "") {
        RUNTIME_MESSAGE := "Open the chat you want to use once, then choose a language."
        ShowToast(RUNTIME_MESSAGE, "warn", 3000)
        PushRuntime()
        return
    }

    AUTO_LANG := lang
    AUTO_PROC := target
    RUNTIME_MESSAGE := ""
    RefreshModeBadge()
    ShowToast("auto translate is on for " LanguageName(lang), "success", 1800)
    PushRuntime()
}

TurnAutoOff(*) {
    global AUTO_LANG, AUTO_PROC, RUNTIME_MESSAGE
    AUTO_LANG := ""
    AUTO_PROC := ""
    RUNTIME_MESSAGE := ""
    HideBadge()
    ShowToast("auto translate is off", "info", 1400)
    PushRuntime()
}

RefreshModeBadge(*) {
    global AUTO_LANG, AUTO_PROC, BADGE
    if (AUTO_LANG == "") {
        HideBadge()
        return
    }
    try active := WinActive("ahk_exe " AUTO_PROC)
    catch
        active := false
    if active {
        if !IsObject(BADGE)
            ShowBadge(AUTO_LANG)
    } else {
        HideBadge()
    }
}

AutoSend() {
    global BUSY, AUTO_LANG
    if BUSY
        return
    BUSY := true
    try {
        saved := ClipboardAll()
        A_Clipboard := ""
        Send "^a"
        Sleep 30
        Send "^c"
        if !ClipWait(0.6) {
            Restore(saved)
            SendInput "{Blind}{Enter}"
            return
        }

        src := Trim(A_Clipboard)
        if (src == "") {
            Restore(saved)
            SendInput "{Blind}{Enter}"
            return
        }

        BadgeBusy(true)
        ShowToast("translating…", "info", 0)
        result := Ask(AUTO_LANG, src)
        HideToast()
        BadgeBusy(false)
        if !result.ok {
            A_Clipboard := src
            ClipWait(1)
            Send "^v"
            Sleep 80
            Restore(saved)
            ShowToast(result.text, "error", 3500)
            return
        }

        A_Clipboard := result.text
        if !ClipWait(2) {
            Restore(saved)
            ShowToast("your clipboard is busy — nothing was sent", "warn", 2800)
            return
        }
        Send "^v"
        Sleep 130
        Restore(saved)
        SendInput "{Blind}{Enter}"
    } finally {
        BUSY := false
    }
}

Outgoing(target) {
    global BUSY
    if BUSY
        return
    BUSY := true
    try {
        saved := ClipboardAll()
        src := GrabText(&usedSelectAll)
        if (src = "") {
            Restore(saved)
            ShowToast("nothing to translate", "warn", 1800)
            return
        }

        ShowToast("translating to " LanguageName(target) "…", "info", 0)
        result := Ask(target, src)
        HideToast()
        if result.ok {
            A_Clipboard := result.text
            if !ClipWait(2) {
                Restore(saved)
                ShowToast("your clipboard is busy — try again", "warn", 2400)
                return
            }
            Send "^v"
            Sleep 120
            Restore(saved)
        } else {
            Restore(saved)
            ShowToast(result.text, "error", 3500)
        }
    } finally {
        BUSY := false
    }
}

Incoming() {
    global BUSY
    if BUSY
        return
    BUSY := true
    try {
        saved := ClipboardAll()
        A_Clipboard := ""
        Send "^c"
        if !ClipWait(0.6) {
            Restore(saved)
            ShowToast("select a message first", "warn", 2200)
            return
        }

        src := A_Clipboard
        Restore(saved)
        ShowToast("reading…", "info", 0)
        result := Ask("en", src)
        HideToast()
        if result.ok
            ShowReader(src, result.text)
        else
            ShowToast(result.text, "error", 3500)
    } finally {
        BUSY := false
    }
}

GrabText(&usedSelectAll) {
    usedSelectAll := false
    A_Clipboard := ""
    Send "^c"
    if ClipWait(0.35)
        return A_Clipboard
    usedSelectAll := true
    Send "^a"
    Sleep 40
    A_Clipboard := ""
    Send "^c"
    if ClipWait(0.8)
        return A_Clipboard
    return ""
}

Restore(saved) {
    A_Clipboard := saved
    saved := ""
}

Ask(target, text) {
    body := '{"target":' JsonStr(target) ',"text":' JsonStr(text) '}'
    result := Post(body)
    if (result.ok || !result.offline)
        return result

    ShowToast("starting the translator…", "info", 0)
    if !StartServer() {
        HideToast()
        return { ok: false, text: "couldn’t start the translator" }
    }
    return Post(body)
}

Post(body) {
    global PORT, TIMEOUT
    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.Open("POST", "http://127.0.0.1:" PORT "/translate", true)
        req.SetRequestHeader("Content-Type", "application/json; charset=utf-8")
        req.Send(body)
        if !req.WaitForResponse(TIMEOUT)
            return { ok: false, offline: false, text: "translation timed out after " TIMEOUT " seconds" }
    } catch {
        return { ok: false, offline: true, text: "translator is not running" }
    }

    out := ReadUtf8(req)
    if (req.Status != 200)
        return { ok: false, offline: false, text: out }
    return { ok: true, offline: false, text: out }
}

ServerAlive() {
    global PORT
    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.Open("GET", "http://127.0.0.1:" PORT "/health", true)
        req.Send()
        if req.WaitForResponse(3)
            return req.Status == 200
    }
    return false
}

StartServer() {
    global SERVER_PID
    if ServerAlive()
        return true

    root := AppRoot()
    log := root "\server.log"
    server := root "\Relay Server.exe"
    if FileExist(server) {
        command := A_ComSpec ' /d /c ""' server '" > "' log '" 2>&1"'
    } else {
        script := root "\src\server.js"
        if !FileExist(script)
            return false
        command := A_ComSpec ' /d /c node "' script '" > "' log '" 2>&1"'
    }

    try Run command, root, "Hide", &SERVER_PID
    catch
        return false

    Loop 60 {
        Sleep 250
        if ServerAlive()
            return true
    }
    return false
}

AppRoot() {
    return RegExReplace(A_ScriptDir, "\\ahk$")
}

ReadUtf8(req) {
    stream := ComObject("ADODB.Stream")
    stream.Type := 1
    stream.Open()
    stream.Write(req.ResponseBody)
    stream.Position := 0
    stream.Type := 2
    stream.Charset := "utf-8"
    text := stream.ReadText()
    stream.Close()
    return text
}

JsonStr(s) {
    out := '"'
    Loop Parse s {
        c := A_LoopField
        o := Ord(c)
        if (c == '"')
            out .= '\"'
        else if (c == "\")
            out .= "\\"
        else if (o == 10)
            out .= "\n"
        else if (o == 13)
            out .= "\r"
        else if (o == 9)
            out .= "\t"
        else if (o < 32 || o > 126)
            out .= Format("\u{:04X}", o)
        else
            out .= c
    }
    return out '"'
}

ShowBadge(lang) {
    global BADGE
    HideBadge()
    BADGE := Gui("+AlwaysOnTop -Caption +ToolWindow +Border +E0x08000000")
    BADGE.BackColor := "FCFBF8"
    BADGE.MarginX := 0
    BADGE.MarginY := 0
    BADGE.SetFont("s9 c25231F", "Segoe UI")
    BADGE.AddText("x14 y8 w210 h18 vBadgeTitle", "Auto translating to " LanguageName(lang))
    BADGE.SetFont("s8 c77736C", "Segoe UI")
    BADGE.AddText("x14 y27 w210 h17", "Ctrl + Alt + 0 to stop")
    BADGE.Show("NoActivate w238 h52 y" (A_ScreenHeight - 122) " x" (A_ScreenWidth - 254))
    try WinSetRegion "0-0 w238 h52 r9-9", "ahk_id " BADGE.Hwnd
}

BadgeBusy(on) {
    global BADGE, AUTO_LANG
    if !IsObject(BADGE)
        return
    try {
        BADGE["BadgeTitle"].Text := on ? "Translating…" : "Auto translating to " LanguageName(AUTO_LANG)
    }
}

HideBadge() {
    global BADGE
    if IsObject(BADGE) {
        try BADGE.Destroy()
    }
    BADGE := ""
}

ShowHighlightBadge() {
    global HL_BADGE
    HideHighlightBadge()
    HL_BADGE := Gui("+AlwaysOnTop -Caption +ToolWindow +Border +E0x08000000")
    HL_BADGE.BackColor := "FCFBF8"
    HL_BADGE.MarginX := 0
    HL_BADGE.MarginY := 0
    HL_BADGE.SetFont("s9 c25231F", "Segoe UI")
    HL_BADGE.AddText("x14 y8 w210 h18", "Read selected text")
    HL_BADGE.SetFont("s8 c77736C", "Segoe UI")
    HL_BADGE.AddText("x14 y27 w210 h17", "Highlight text to read it in English")
    HL_BADGE.Show("NoActivate w238 h52 y" (A_ScreenHeight - 180) " x" (A_ScreenWidth - 254))
    try WinSetRegion "0-0 w238 h52 r9-9", "ahk_id " HL_BADGE.Hwnd
}

HideHighlightBadge() {
    global HL_BADGE
    if IsObject(HL_BADGE) {
        try HL_BADGE.Destroy()
    }
    HL_BADGE := ""
}

ShowToast(message, kind := "info", duration := 1800) {
    global TOAST
    HideToast()
    accents := Map("info", "77736C", "success", "25815F", "warn", "A36B16", "error", "B7473D")
    TOAST := Gui("+AlwaysOnTop -Caption +ToolWindow +Border +E0x08000000")
    TOAST.BackColor := "FCFBF8"
    TOAST.MarginX := 0
    TOAST.MarginY := 0
    TOAST.SetFont("s13 c" accents.Get(kind, "77736C"), "Segoe UI Symbol")
    TOAST.AddText("x12 y9 w15 h24 Center", "•")
    TOAST.SetFont("s9 c25231F", "Segoe UI")
    TOAST.AddText("x34 y9 w280 h38 +Wrap", message)
    TOAST.Show("NoActivate w328 h56 x" (A_ScreenWidth - 344) " y" (A_ScreenHeight - 80))
    try WinSetRegion "0-0 w328 h56 r9-9", "ahk_id " TOAST.Hwnd
    if (duration > 0)
        SetTimer HideToast, -duration
}

HideToast(*) {
    global TOAST
    if IsObject(TOAST) {
        try TOAST.Destroy()
    }
    TOAST := ""
}

ShowReader(original, translated) {
    global READER
    CloseReader()
    READER := Gui("+AlwaysOnTop +Resize +MinSize440x330", "Relay • English")
    READER.BackColor := "161B22"
    READER.MarginX := 18
    READER.MarginY := 14
    READER.SetFont("s11 bold cF5F7FB", "Segoe UI")
    READER.AddText("w470", "what they said")
    READER.SetFont("s9 cAAB6C5", "Segoe UI")
    READER.AddText("w470 y+2", "original")
    READER.SetFont("s10 c1A1F24", "Segoe UI")
    READER.AddEdit("w470 r3 ReadOnly -E0x200", original)
    READER.SetFont("s14 bold cF5F7FB", "Segoe UI")
    READER.AddText("w470 y+16", "in English")
    READER.SetFont("s11 c1A1F24", "Segoe UI")
    READER.AddEdit("w470 r5 ReadOnly", translated)
    READER.SetFont("s9", "Segoe UI")
    copy := READER.AddButton("w470 y+14", "Copy English  •  Esc closes")
    copy.OnEvent("Click", (*) => CopyReader(translated))
    READER.OnEvent("Escape", CloseReader)
    READER.OnEvent("Close", CloseReader)
    MouseGetPos &mx, &my
    x := Min(Max(mx - 240, 0), A_ScreenWidth - 510)
    y := Min(my + 24, A_ScreenHeight - 370)
    READER.Show("NoActivate AutoSize x" x " y" y)
}

CopyReader(text) {
    A_Clipboard := text
    ShowToast("English copied", "success", 1400)
    CloseReader()
}

CloseReader(*) {
    global READER
    if IsObject(READER) {
        try READER.Destroy()
    }
    READER := ""
}

CloseApp(*) {
    global SERVER_PID
    if (SERVER_PID && ProcessExist(SERVER_PID)) {
        try ProcessClose SERVER_PID
    }
}
