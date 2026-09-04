#Requires AutoHotkey v2.0
#SingleInstance Force
#NoTrayIcon
Persistent
SendMode "Input"
SetWorkingDir A_ScriptDir

configuredPort := EnvGet("RELAY_PORT")
PORT := configuredPort != "" ? Integer(configuredPort) : 8765
TIMEOUT := 45
global BUSY := false
global POLLING := false
global AUTO_LANG := ""
global AUTO_PROC := ""
global LAST_EXTERNAL_PROC := ""
global RUNTIME_MESSAGE := ""
global CONTROL_ID := 0
global BADGE := ""
global BADGE_STATE := ""
global READER := ""
global TOAST := ""
global SERVER_PID := 0
global SEND_MODE := "instant"
global PREVIEW_READY := false
global PREVIEW_PROC := ""
global PREVIEW_ORIGINAL := ""
global PREVIEW_GUI := ""
global PREVIEW_MEANING := ""
global PREVIEW_STRIPE := ""
global PREVIEW_VERIFY := ""
global ALLOWED_APPS := Map()
global SAFETY_PAUSED := false
global SAFETY_REASON := ""
global SELECTION_POPUP_ENABLED := true
global SELECTION_START_X := 0
global SELECTION_START_Y := 0
global LAST_SELECTION_CLICK := 0
global LAST_SELECTION_TEXT := ""
global LAST_SELECTION_AT := 0

OnExit(CloseApp)
StartServer(false)
TrackActiveWindow()
PushRuntime()
SetTimer TrackActiveWindow, 250
SetTimer PollControl, 350
SetTimer RefreshModeBadge, 500
SetTimer PushRuntime, 2000

#HotIf SELECTION_POPUP_ENABLED
~LButton:: MarkSelectionStart()
~LButton Up:: MaybeReadSelection()
#HotIf

#HotIf ReaderOpen()
Esc:: CloseReader()
#HotIf

#HotIf ReviewArmed()
Esc:: CancelReview()
^z:: CancelReview()
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
    if (proc == "" || IsOwnProcess(proc))
        return
    changed := proc != LAST_EXTERNAL_PROC
    if changed {
        LAST_EXTERNAL_PROC := proc
        RUNTIME_MESSAGE := ""
    }
    safetyChanged := RefreshSafety(proc)
    if (changed || safetyChanged)
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
    global POLLING, CONTROL_ID, SELECTION_POPUP_ENABLED
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
        else if (action == "auto-target") {
            setting := StrSplit(value, "|")
            SetAuto(setting[1], setting.Length >= 2 ? setting[2] : CurrentTarget())
        }
        else if (action == "auto-off")
            TurnAutoOff()
        else if (action == "read-selection")
            SetTimer Incoming, -120
        else if (action == "selection-popup")
            SetSelectionPopup(value)
        else if (action == "safety-apps")
            SetAllowedApps(value)
        else if (action == "send-mode")
            SetSendMode(value)
    } catch {
    } finally {
        POLLING := false
    }
}

PushRuntime() {
    global AUTO_LANG, AUTO_PROC, LAST_EXTERNAL_PROC, RUNTIME_MESSAGE, SEND_MODE, PREVIEW_READY, SAFETY_PAUSED, SAFETY_REASON, SELECTION_POPUP_ENABLED, PORT
    body := '{"autoLang":' JsonStr(AUTO_LANG)
        . ',"autoProc":' JsonStr(AUTO_PROC)
        . ',"targetProc":' JsonStr(LAST_EXTERNAL_PROC)
        . ',"sendMode":' JsonStr(SEND_MODE)
        . ',"previewReady":' (PREVIEW_READY ? "true" : "false")
        . ',"selectionPopupEnabled":' (SELECTION_POPUP_ENABLED ? "true" : "false")
        . ',"safetyPaused":' (SAFETY_PAUSED ? "true" : "false")
        . ',"safetyReason":' JsonStr(SAFETY_REASON)
        . ',"message":' JsonStr(RUNTIME_MESSAGE) '}'
    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.Open("POST", "http://127.0.0.1:" PORT "/api/runtime", false)
        req.SetRequestHeader("Content-Type", "application/json; charset=utf-8")
        req.Send(body)
    }
}

LanguageName(lang) {
    return Map("ko", "Korean", "ja", "Japanese", "fr", "French", "en", "English").Get(lang, lang)
}

SetSelectionPopup(value) {
    global SELECTION_POPUP_ENABLED, LAST_SELECTION_TEXT
    SELECTION_POPUP_ENABLED := StrLower(value) != "false" && value != "0"
    LAST_SELECTION_TEXT := ""
    if !SELECTION_POPUP_ENABLED
        CloseReader()
    PushRuntime()
}

MarkSelectionStart() {
    global SELECTION_START_X, SELECTION_START_Y
    MouseGetPos &SELECTION_START_X, &SELECTION_START_Y
}

MaybeReadSelection() {
    global SELECTION_START_X, SELECTION_START_Y, LAST_SELECTION_CLICK
    MouseGetPos &x, &y
    dragged := Abs(x - SELECTION_START_X) > 4 || Abs(y - SELECTION_START_Y) > 4
    doubled := !dragged && LAST_SELECTION_CLICK > 0 && A_TickCount - LAST_SELECTION_CLICK < 450
    LAST_SELECTION_CLICK := A_TickCount
    if dragged || doubled
        SetTimer ReadHighlightedText, -180
}

ReadHighlightedText() {
    global BUSY, LAST_SELECTION_TEXT, LAST_SELECTION_AT
    if BUSY
        return
    try {
        processName := WinGetProcessName("A")
    } catch {
        return
    }
    if IsOwnProcess(processName) || SelectionSafetyReason(processName) != ""
        return
    BUSY := true
    try {
        saved := ClipboardAll()
        A_Clipboard := ""
        Send "^c"
        if !ClipWait(0.55) {
            Restore(saved)
            return
        }
        src := Trim(A_Clipboard)
        Restore(saved)
        if StrLen(src) < 2 || StrLen(src) > 800
            return
        if src == LAST_SELECTION_TEXT && A_TickCount - LAST_SELECTION_AT < 1400
            return
        LAST_SELECTION_TEXT := src
        LAST_SELECTION_AT := A_TickCount
        result := Ask("en", src, "selection", processName)
        if result.ok
            ShowReader(src, result.text)
    } finally {
        BUSY := false
    }
}

SetAllowedApps(value) {
    global ALLOWED_APPS
    ALLOWED_APPS.Clear()
    Loop Parse value, "|" {
        appName := Trim(A_LoopField)
        if (appName != "")
            ALLOWED_APPS[StrLower(appName)] := appName
    }
    RefreshSafety(CurrentTarget())
    PushRuntime()
}

AllowApp(processName) {
    global ALLOWED_APPS
    if (processName != "")
        ALLOWED_APPS[StrLower(processName)] := processName
}

SafetyReason(processName, checkContext := true) {
    global ALLOWED_APPS
    key := StrLower(processName)
    blocked := Map(
        "windowsterminal.exe", "Terminal window",
        "cmd.exe", "Terminal window",
        "powershell.exe", "Terminal window",
        "pwsh.exe", "Terminal window",
        "conhost.exe", "Terminal window",
        "mintty.exe", "Terminal window",
        "bash.exe", "Terminal window",
        "wsl.exe", "Terminal window",
        "ssh.exe", "Terminal window",
        "1password.exe", "Password manager",
        "bitwarden.exe", "Password manager",
        "keepass.exe", "Password manager",
        "keepassxc.exe", "Password manager",
        "credentialuibroker.exe", "Password window"
    )
    if blocked.Has(key)
        return blocked[key]
    if !ALLOWED_APPS.Has(key)
        return "App is not allowed"
    if !checkContext
        return ""

    try {
        control := ControlGetFocus("A")
        if (control != "" && (ControlGetStyle(control, "A") & 0x20))
            return "Password field"
    }
    try {
        title := WinGetTitle("A")
        if RegExMatch(title, "i)\b(checkout|payment|billing|credit card|debit card|card details|password|sign[ -]?in|log[ -]?in|bank|wallet|paypal|stripe)\b")
            return "Payment or sign-in page"
    }
    return ""
}

SelectionSafetyReason(processName) {
    key := StrLower(processName)
    if RegExMatch(key, "i)^(windowsterminal|cmd|powershell|pwsh|conhost|mintty|bash|wsl|ssh|1password|bitwarden|keepass|keepassxc|credentialuibroker)\.exe$")
        return "Blocked app"
    try {
        control := ControlGetFocus("A")
        if (control != "" && (ControlGetStyle(control, "A") & 0x20))
            return "Password field"
    }
    try {
        title := WinGetTitle("A")
        if RegExMatch(title, "i)\b(checkout|payment|billing|credit card|debit card|card details|password|sign[ -]?in|log[ -]?in|bank|wallet|paypal|stripe)\b")
            return "Sensitive page"
    }
    return ""
}

RefreshSafety(processName) {
    global AUTO_LANG, AUTO_PROC, SAFETY_PAUSED, SAFETY_REASON
    reason := ""
    if (AUTO_LANG != "" && StrLower(processName) == StrLower(AUTO_PROC))
        reason := SafetyReason(processName)
    paused := reason != ""
    changed := paused != SAFETY_PAUSED || reason != SAFETY_REASON
    SAFETY_PAUSED := paused
    SAFETY_REASON := reason
    return changed
}

AutoArmed() {
    global AUTO_LANG, AUTO_PROC
    if (AUTO_LANG == "")
        return false
    try return WinActive("ahk_exe " AUTO_PROC) && SafetyReason(AUTO_PROC) == ""
    return false
}

SetAuto(lang, target := "") {
    global AUTO_LANG, AUTO_PROC, RUNTIME_MESSAGE, PREVIEW_READY, PREVIEW_PROC, PREVIEW_ORIGINAL
    if (target == "")
        target := CurrentTarget()
    if (target == "") {
        RUNTIME_MESSAGE := "Open the chat you want to use once, then choose a language."
        ShowToast(RUNTIME_MESSAGE, "warn", 3000)
        PushRuntime()
        return
    }
    reason := SafetyReason(target, false)
    if (reason != "") {
        RUNTIME_MESSAGE := reason == "App is not allowed" ? "Choose this app in Relay before turning on Auto Translate." : "Relay will not type in this app."
        ShowToast(RUNTIME_MESSAGE, "warn", 3000)
        PushRuntime()
        return
    }

    AUTO_LANG := lang
    AUTO_PROC := target
    PREVIEW_READY := false
    PREVIEW_PROC := ""
    PREVIEW_ORIGINAL := ""
    HideReview()
    RUNTIME_MESSAGE := ""
    RefreshSafety(target)
    RefreshModeBadge()
    ShowToast("auto translate is on for " LanguageName(lang), "success", 1800)
    PushRuntime()
}

TurnAutoOff(*) {
    global AUTO_LANG, AUTO_PROC, RUNTIME_MESSAGE, PREVIEW_READY, PREVIEW_PROC, PREVIEW_ORIGINAL, SAFETY_PAUSED, SAFETY_REASON
    AUTO_LANG := ""
    AUTO_PROC := ""
    RUNTIME_MESSAGE := ""
    PREVIEW_READY := false
    PREVIEW_PROC := ""
    PREVIEW_ORIGINAL := ""
    SAFETY_PAUSED := false
    SAFETY_REASON := ""
    HideReview()
    HideBadge()
    ShowToast("auto translate is off", "info", 1400)
    PushRuntime()
}

SetSendMode(mode) {
    global SEND_MODE, PREVIEW_READY, PREVIEW_PROC, PREVIEW_ORIGINAL
    SEND_MODE := mode == "review" ? "review" : "instant"
    PREVIEW_READY := false
    PREVIEW_PROC := ""
    PREVIEW_ORIGINAL := ""
    HideReview()
    PushRuntime()
}

RefreshModeBadge(*) {
    global AUTO_LANG, AUTO_PROC, BADGE, BADGE_STATE, SAFETY_PAUSED, SAFETY_REASON
    if (AUTO_LANG == "") {
        HideBadge()
        return
    }
    try active := WinActive("ahk_exe " AUTO_PROC)
    catch
        active := false
    if active {
        RefreshSafety(AUTO_PROC)
        nextState := AUTO_LANG "|" SAFETY_PAUSED "|" SAFETY_REASON
        if (!IsObject(BADGE) || nextState != BADGE_STATE)
            ShowBadge(AUTO_LANG, SAFETY_PAUSED, SAFETY_REASON)
    } else {
        HideBadge()
    }
}

AutoSend() {
    global BUSY, AUTO_LANG, AUTO_PROC, SEND_MODE, PREVIEW_READY, PREVIEW_PROC, PREVIEW_ORIGINAL
    if BUSY
        return
    if (SEND_MODE == "review" && PREVIEW_READY && PREVIEW_PROC == AUTO_PROC) {
        PREVIEW_READY := false
        PREVIEW_PROC := ""
        PREVIEW_ORIGINAL := ""
        HideReview()
        PushRuntime()
        SendInput "{Blind}{Enter}"
        ShowToast("sent", "success", 1000)
        return
    }
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
        result := Ask(AUTO_LANG, src, "auto", AUTO_PROC)
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
        if (SEND_MODE == "review") {
            PREVIEW_READY := true
            PREVIEW_PROC := AUTO_PROC
            PREVIEW_ORIGINAL := src
            ShowReview(src, result.text, AUTO_LANG)
            PushRuntime()
        } else {
            SendInput "{Blind}{Enter}"
        }
    } finally {
        BUSY := false
    }
}

ReviewArmed() {
    global PREVIEW_READY, PREVIEW_PROC, AUTO_PROC
    return PREVIEW_READY && PREVIEW_PROC == AUTO_PROC && AutoArmed()
}

CancelReview() {
    global BUSY, PREVIEW_READY, PREVIEW_PROC, PREVIEW_ORIGINAL
    if BUSY || !PREVIEW_READY
        return
    BUSY := true
    try {
        saved := ClipboardAll()
        A_Clipboard := PREVIEW_ORIGINAL
        if !ClipWait(1) {
            Restore(saved)
            ShowToast("couldn’t restore the original", "error", 2200)
            return
        }
        Send "^a"
        Sleep 30
        Send "^v"
        Sleep 90
        Restore(saved)
        PREVIEW_READY := false
        PREVIEW_PROC := ""
        PREVIEW_ORIGINAL := ""
        HideReview()
        PushRuntime()
        ShowToast("original restored", "success", 1300)
    } finally {
        BUSY := false
    }
}

PreviewLine(text, max := 150) {
    text := RegExReplace(Trim(text), "[\r\n]+", " ")
    return StrLen(text) > max ? SubStr(text, 1, max - 1) "…" : text
}

ShowReview(original, translated, target := "") {
    global PREVIEW_GUI, PREVIEW_MEANING, PREVIEW_VERIFY, PREVIEW_STRIPE
    HideToast()
    HideReview()
    shade := Palette()
    W := 336
    H := 120
    PREVIEW_GUI := Surface()

    ; colour stripe down the edge, same idea as the toast - it turns green or
    ; amber once the meaning has been checked, so the answer is readable from
    ; the corner of my eye without reading a word
    PREVIEW_STRIPE := PREVIEW_GUI.AddText("x0 y0 w3 h" H, "")
    PREVIEW_STRIPE.Opt("+Background" shade["faint"])

    ; no title bar row. the thing only shows up when a draft is waiting, so
    ; "Ready to send" was just eating twenty pixels to say what was obvious.
    PREVIEW_GUI.SetFont("s8 c" shade["faint"], "Segoe UI")
    PREVIEW_GUI.AddText("x17 y10 w" (W - 32) " h15", PreviewLine(original, 78))

    ; the actual message, the only thing that needs to be readable at a glance
    PREVIEW_GUI.SetFont("s11 c" shade["text"], "Segoe UI")
    PREVIEW_GUI.AddText("x17 y27 w" (W - 32) " h38 +Wrap", PreviewLine(translated, 120))

    ; filled in a moment later once it's been read back to english
    PREVIEW_GUI.SetFont("s8 c" shade["faint"], "Segoe UI")
    PREVIEW_MEANING := PREVIEW_GUI.AddText("x17 y69 w" (W - 32) " h28 +Wrap", "reading it back…")

    PREVIEW_GUI.SetFont("s8 c" shade["faint"], "Segoe UI")
    hint := (target != "" ? LanguageName(target) "  ·  " : "") "Enter sends  ·  Esc restores"
    PREVIEW_GUI.AddText("x17 y100 w" (W - 32) " h14", hint)

    PREVIEW_VERIFY := { target: target, original: original, translated: translated }
    SetTimer RunReviewCheck, -50
    PlaceNear(PREVIEW_GUI, W, H)
    Round(PREVIEW_GUI, W, H, 10)
}

; the draft is already on screen by the time this runs, so a slow check just
; means the meaning line fills in late. it never holds up the message.
RunReviewCheck() {
    global PREVIEW_VERIFY, PREVIEW_GUI
    if !IsObject(PREVIEW_VERIFY) || !IsObject(PREVIEW_GUI)
        return
    job := PREVIEW_VERIFY
    body := '{"target":' JsonStr(job.target)
        . ',"text":' JsonStr(job.original)
        . ',"translation":' JsonStr(job.translated) '}'
    answer := PostJson("/api/verify", body, 20)
    ; the popup can be gone or moved on to another message by now
    if !IsObject(PREVIEW_GUI) || !IsObject(PREVIEW_VERIFY) || PREVIEW_VERIFY.translated != job.translated
        return
    if !answer.ok {
        ShowReviewMeaning("", "", "")
        return
    }
    ShowReviewMeaning(JsonField(answer.text, "meaning"), JsonField(answer.text, "verdict"), JsonField(answer.text, "summary"))
}

ShowReviewMeaning(meaning, verdict, summary) {
    global PREVIEW_MEANING, PREVIEW_STRIPE
    if !IsObject(PREVIEW_MEANING)
        return
    shade := Palette()
    if (meaning == "") {
        try {
            PREVIEW_MEANING.SetFont("c" shade["faint"])
            PREVIEW_MEANING.Text := "couldn't read it back"
        }
        return
    }
    colour := verdict == "bad" ? shade["error"] : verdict == "check" ? shade["warn"] : shade["success"]
    line := (verdict == "ok" ? "means  " : "check this  ") '"' PreviewLine(meaning, 100) '"'
    if (verdict != "ok" && summary != "")
        line .= "  —  " summary
    try {
        PREVIEW_MEANING.SetFont("c" colour)
        PREVIEW_MEANING.Text := line
    }
    ; the stripe carries the same answer, so a glance at the edge is enough
    try PREVIEW_STRIPE.Opt("+Background" colour)
    try PREVIEW_STRIPE.Redraw()
}

HideReview(*) {
    global PREVIEW_GUI, PREVIEW_MEANING, PREVIEW_VERIFY, PREVIEW_STRIPE
    if IsObject(PREVIEW_GUI) {
        try PREVIEW_GUI.Destroy()
    }
    PREVIEW_GUI := ""
    PREVIEW_MEANING := ""
    PREVIEW_VERIFY := ""
    PREVIEW_STRIPE := ""
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
        result := Ask("en", src, "selection", CurrentTarget())
        HideToast()
        if result.ok
            ShowReader(src, result.text)
        else
            ShowToast(result.text, "error", 3500)
    } finally {
        BUSY := false
    }
}

Restore(saved) {
    A_Clipboard := saved
    saved := ""
}

Ask(target, text, origin := "", appName := "") {
    body := '{"target":' JsonStr(target)
        . ',"text":' JsonStr(text)
        . ',"origin":' JsonStr(origin)
        . ',"app":' JsonStr(appName) '}'
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

StartServer(wait := true) {
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

    ; on startup don't sit here waiting. everything below the StartServer() call
    ; - hotkeys, polling, the heartbeat - only gets set up once this returns, and
    ; each ServerAlive() check can burn 3 seconds, so waiting here left the
    ; helper completely dead for minutes. the timers retry on their own anyway.
    if !wait
        return true

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

PostJson(path, body, timeout := 20) {
    global PORT
    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.Open("POST", "http://127.0.0.1:" PORT path, true)
        req.SetRequestHeader("Content-Type", "application/json; charset=utf-8")
        req.Send(body)
        if !req.WaitForResponse(timeout)
            return { ok: false, text: "" }
    } catch {
        return { ok: false, text: "" }
    }
    out := ReadUtf8(req)
    return { ok: req.Status == 200, text: out }
}

; enough json reading for one flat object of strings, which is all the verify
; reply is. not worth pulling in a parser for it.
JsonField(json, key) {
    if !RegExMatch(json, '"' key '"\s*:\s*"((?:[^"\\]|\\.)*)"', &m)
        return ""
    s := m[1]
    while RegExMatch(s, "\\u([0-9a-fA-F]{4})", &u)
        s := StrReplace(s, u[0], Chr("0x" u[1]))
    s := StrReplace(s, "\n", "`n")
    s := StrReplace(s, "\r", "")
    s := StrReplace(s, "\t", "`t")
    s := StrReplace(s, '\"', '"')
    s := StrReplace(s, "\/", "/")
    return StrReplace(s, "\\", "\")
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

; a thin pill at the top of the screen, the way a recording indicator sits.
; it used to be a two line card in the bottom right telling me a keyboard
; shortcut i never wanted. all it has to say is that it's on and in what.
ShowBadge(lang, paused := false, reason := "") {
    global BADGE, BADGE_STATE
    HideBadge()
    shade := Palette()
    BADGE_STATE := lang "|" paused "|" reason
    label := paused ? PreviewLine(reason, 34) : "Translating to " LanguageName(lang)

    H := 28
    W := 60 + (StrLen(label) * 7)
    W := Min(Max(W, 150), 320)
    BADGE := Surface()
    dot := BADGE.AddText("x16 y" ((H // 2) - 4) " w8 h8", "")
    dot.Opt("+Background" (paused ? shade["warn"] : shade["success"]))
    BADGE.SetFont("s9 c" (paused ? shade["text"] : shade["muted"]), "Segoe UI")
    BADGE.AddText("x32 y0 w" (W - 44) " h" H " +0x200", label)
    BADGE.Show("NoActivate w" W " h" H " x" ((A_ScreenWidth - W) // 2) " y 10")
    Round(BADGE, W, H, H // 2)
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
    global BADGE, BADGE_STATE
    if IsObject(BADGE) {
        try BADGE.Destroy()
    }
    BADGE := ""
    BADGE_STATE := ""
}

; ---------------------------------------------------------------------------
; one look for every floating window. before this the reader was the only one
; that knew about dark mode, so on a dark desktop the toast and the badge were
; white rectangles sitting on top of everything.
; ---------------------------------------------------------------------------

Palette() {
    if SystemDark() {
        return Map(
            "bg", "1B1A19", "text", "F2F0EB", "muted", "9C978E", "faint", "6E6961",
            "line", "34322F",
            "info", "9C978E", "success", "5FBF95", "warn", "D9A441", "error", "E0736A"
        )
    }
    return Map(
        "bg", "FCFBF8", "text", "25231F", "muted", "77736C", "faint", "A8A29A",
        "line", "E8E4DC",
        "info", "77736C", "success", "25815F", "warn", "A36B16", "error", "B7473D"
    )
}

Surface() {
    panel := Gui("+AlwaysOnTop -Caption +ToolWindow +E0x08000000")
    panel.BackColor := Palette()["bg"]
    panel.MarginX := 0
    panel.MarginY := 0
    return panel
}

Round(panel, w, h, radius := 10) {
    try WinSetRegion "0-0 w" w " h" h " r" radius "-" radius, "ahk_id " panel.Hwnd
}

; put it where i'm actually looking. the bottom right corner is where windows
; stacks its own notifications and it's the furthest point from the text i'm
; typing, so nothing lives there any more. CaretGetPos comes back empty in
; discord and anything else chromium, hence the mouse fallback.
PlaceNear(panel, w, h) {
    px := 0
    py := 0
    gap := 0
    try {
        CaretGetPos &cx, &cy
        if (cx > 0 && cy > 0) {
            px := cx
            py := cy
            gap := 24
        }
    }
    if (gap == 0) {
        try {
            MouseGetPos &mx, &my
            px := mx
            py := my
            gap := 20
        }
    }
    if (gap == 0) {
        ; nothing to anchor to - centre it low rather than shove it in a corner
        panel.Show("NoActivate w" w " h" h
            . " x" ((A_ScreenWidth - w) // 2) " y" (A_ScreenHeight - h - 140))
        return
    }

    ; above by default: chat boxes sit at the bottom of a window, so dropping
    ; underneath usually lands on the send button or off the screen
    x := px - (w // 3)
    y := py - h - gap
    if (y < 8)
        y := py + gap
    x := Min(Max(x, 8), A_ScreenWidth - w - 8)
    y := Min(Max(y, 8), A_ScreenHeight - h - 8)
    panel.Show("NoActivate w" w " h" h " x" x " y" y)
}

ShowToast(message, kind := "info", duration := 1800) {
    global TOAST
    HideToast()
    shade := Palette()
    W := 264
    H := 42
    TOAST := Surface()
    ; a colour stripe down the edge says done / careful / broken without
    ; needing an icon set. the old code built this palette and never used it.
    stripe := TOAST.AddText("x0 y0 w3 h" H, "")
    stripe.Opt("+Background" shade[kind])
    TOAST.SetFont("s9 c" shade["text"], "Segoe UI")
    TOAST.AddText("x15 y0 w" (W - 28) " h" H " +Wrap +0x200", message)
    PlaceNear(TOAST, W, H)
    Round(TOAST, W, H, 8)
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
    shade := Palette()
    W := 380
    H := 150
    READER := Surface()

    ; same stripe as the other two panels so all three read as one thing
    stripe := READER.AddText("x0 y0 w3 h" H, "")
    stripe.Opt("+Background" shade["info"])

    ; dropped the "Relay · English" header - i know what my own app is, and it
    ; was taking the space the translation should have had
    READER.SetFont("s8 c" shade["faint"], "Segoe UI")
    READER.AddText("x17 y12 w" (W - 32) " h15", PreviewLine(original, 90))
    READER.SetFont("s12 c" shade["text"], "Segoe UI")
    READER.AddText("x17 y32 w" (W - 32) " h74 +Wrap", PreviewLine(translated, 240))
    READER.SetFont("s8 c" shade["faint"], "Segoe UI")
    READER.AddText("x17 y118 w180 h20 +0x200", "closes on its own")
    READER.SetFont("s9 c" shade["muted"], "Segoe UI")
    copy := READER.AddButton("x" (W - 104) " y114 w88 h26", "Copy")
    copy.OnEvent("Click", (*) => CopyReader(translated))
    READER.OnEvent("Escape", CloseReader)
    READER.OnEvent("Close", CloseReader)

    PlaceNear(READER, W, H)
    Round(READER, W, H, 10)
    SetTimer CloseReader, -5200
}

SystemDark() {
    try return RegRead("HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme") == 0
    return false
}

ReaderOpen() {
    global READER
    return IsObject(READER)
}

CopyReader(text) {
    A_Clipboard := text
    ShowToast("English copied", "success", 1400)
    CloseReader()
}

CloseReader(*) {
    global READER
    SetTimer CloseReader, 0
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
