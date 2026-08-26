"""Create Zcord.lnk with a persisted System.AppUserModel.ID (taskbar Z icon)."""
from __future__ import annotations

import sys
from pathlib import Path

import pythoncom
from win32com.propsys import propsys, pscon
from win32com.shell import shell


def create_shortcut(
    lnk_path: str,
    exe_path: str,
    icon_path: str,
    work_dir: str,
    aumid: str = "com.zcord.portable",
    name: str = "Zcord",
) -> None:
    pythoncom.CoInitialize()
    shortcut = pythoncom.CoCreateInstance(
        shell.CLSID_ShellLink, None, pythoncom.CLSCTX_INPROC_SERVER, shell.IID_IShellLink
    )
    shortcut.SetPath(exe_path)
    shortcut.SetWorkingDirectory(work_dir)
    shortcut.SetIconLocation(icon_path, 0)
    shortcut.SetDescription(name)

    prop_store = shortcut.QueryInterface(propsys.IID_IPropertyStore)
    prop_store.SetValue(pscon.PKEY_AppUserModel_ID, propsys.PROPVARIANTType(aumid))
    prop_store.SetValue(pscon.PKEY_AppUserModel_RelaunchCommand, propsys.PROPVARIANTType(f'"{exe_path}"'))
    prop_store.SetValue(pscon.PKEY_AppUserModel_RelaunchIconResource, propsys.PROPVARIANTType(f"{icon_path},0"))
    prop_store.SetValue(pscon.PKEY_AppUserModel_RelaunchDisplayNameResource, propsys.PROPVARIANTType(name))
    prop_store.Commit()

    persist = shortcut.QueryInterface(pythoncom.IID_IPersistFile)
    Path(lnk_path).parent.mkdir(parents=True, exist_ok=True)
    persist.Save(lnk_path, 0)

    # verify
    shortcut2 = pythoncom.CoCreateInstance(
        shell.CLSID_ShellLink, None, pythoncom.CLSCTX_INPROC_SERVER, shell.IID_IShellLink
    )
    persist2 = shortcut2.QueryInterface(pythoncom.IID_IPersistFile)
    persist2.Load(lnk_path)
    store2 = shortcut2.QueryInterface(propsys.IID_IPropertyStore)
    got = store2.GetValue(pscon.PKEY_AppUserModel_ID).ToString()
    if got != aumid:
        raise SystemExit(f"AUMID not persisted on {lnk_path}: got {got!r}")
    print(f"OK {lnk_path} AUMID={got}")


def main() -> None:
    if len(sys.argv) < 5:
        print("usage: make-zcord-shortcut.py <exe> <ico> <lnk> <workdir>")
        raise SystemExit(2)
    create_shortcut(sys.argv[3], sys.argv[1], sys.argv[2], sys.argv[4])


if __name__ == "__main__":
    main()
