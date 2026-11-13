from pathlib import Path


def _installer_hook() -> str:
    path = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src-tauri"
        / "windows"
        / "installer-hooks.nsh"
    )
    return path.read_text(encoding="utf-8")


def test_installer_uses_documented_windows_10_1709_floor():
    hook = _installer_hook()
    assert '$1 < 16299' in hook
    assert "Windows 10 version 1709 (build 16299) or newer" in hook
    assert '$1 < 19045' not in hook


def test_installer_allows_documented_enterprise_ltsc_exceptions():
    hook = _installer_hook()
    assert '$3 == "EnterpriseS"' in hook
    assert '$1 == 10240' in hook
    assert '$1 == 14393' in hook
    assert "Windows 10 Enterprise 2015/2016 LTSC" in hook


def test_installer_uses_windows_11_21h2_floor():
    hook = _installer_hook()
    assert '$1 < 22000' in hook
    assert "Windows 11 version 21H2 (build 22000) or newer" in hook


def test_installer_remains_x64_only_and_fails_closed_for_unknown_hosts():
    hook = _installer_hook()
    assert "RunningX64" in hook
    assert "No files have been installed." in hook
