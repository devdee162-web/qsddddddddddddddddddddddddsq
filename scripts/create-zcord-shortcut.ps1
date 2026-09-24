# Creates Zcord.lnk with a REAL System.AppUserModel.ID (required for Z taskbar icon).
param(
    [Parameter(Mandatory = $true)][string]$ExePath,
    [Parameter(Mandatory = $true)][string]$IconPath,
    [Parameter(Mandatory = $true)][string]$ShortcutPath,
    [string]$AppUserModelId = "com.zcord.app",
    [string]$WorkingDirectory = "",
    [string]$Arguments = ""
)

$ErrorActionPreference = "Stop"
if (-not $WorkingDirectory) { $WorkingDirectory = Split-Path -Parent $ExePath }

$cs = @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

public static class ZcordShortcut2 {
    [DllImport("propsys.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void InitPropVariantFromString([MarshalAs(UnmanagedType.LPWStr)] string psz, out PropVariant pvar);

    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref PropVariant pvar);

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    public class ShellLinkCom { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    public interface IShellLinkW {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cchMaxPath, IntPtr pfd, int fFlags);
        void GetIDList(out IntPtr ppidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMaxName);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cchMaxPath);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cchMaxPath);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
        void GetHotkey(out short pwHotkey);
        void SetHotkey(short wHotkey);
        void GetShowCmd(out int piShowCmd);
        void SetShowCmd(int iShowCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cchIconPath, out int piIcon);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, int dwReserved);
        void Resolve(IntPtr hwnd, int fFlags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PropertyKey {
        public Guid fmtid;
        public uint pid;
        public PropertyKey(Guid f, uint p) { fmtid = f; pid = p; }
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct PropVariant {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr pointerValue;
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    public interface IPropertyStore {
        uint GetCount(out uint cProps);
        uint GetAt(uint iProp, out PropertyKey pkey);
        uint GetValue(ref PropertyKey key, out PropVariant pv);
        uint SetValue(ref PropertyKey key, ref PropVariant pv);
        uint Commit();
    }

    public static void Create(string lnkPath, string exePath, string workDir, string iconPath, string aumid, string desc, string args) {
        var link = (IShellLinkW)new ShellLinkCom();
        link.SetPath(exePath);
        link.SetWorkingDirectory(workDir);
        if (!string.IsNullOrEmpty(args)) link.SetArguments(args);
        link.SetIconLocation(iconPath, 0);
        link.SetDescription(desc);

        var store = (IPropertyStore)link;
        var fmt = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");

        SetProp(store, new PropertyKey(fmt, 5), aumid);
        var relaunch = string.IsNullOrEmpty(args) ? ("\"" + exePath + "\"") : ("\"" + exePath + "\" " + args);
        SetProp(store, new PropertyKey(fmt, 2), relaunch);
        SetProp(store, new PropertyKey(fmt, 3), iconPath + ",0");
        SetProp(store, new PropertyKey(fmt, 4), desc);

        var hr = store.Commit();
        if (hr != 0) throw new Exception("IPropertyStore.Commit failed: 0x" + hr.ToString("X"));

        var file = (IPersistFile)link;
        file.Save(lnkPath, true);
    }

    static void SetProp(IPropertyStore store, PropertyKey key, string value) {
        PropVariant pv;
        InitPropVariantFromString(value, out pv);
        try {
            var hr = store.SetValue(ref key, ref pv);
            if (hr != 0) throw new Exception("SetValue pid=" + key.pid + " failed: 0x" + hr.ToString("X"));
        } finally {
            PropVariantClear(ref pv);
        }
    }

    public static string ReadAumid(string lnkPath) {
        var link = (IShellLinkW)new ShellLinkCom();
        ((IPersistFile)link).Load(lnkPath, 0);
        var store = (IPropertyStore)link;
        var key = new PropertyKey(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);
        PropVariant pv;
        store.GetValue(ref key, out pv);
        try {
            if (pv.vt == 31 && pv.pointerValue != IntPtr.Zero)
                return Marshal.PtrToStringUni(pv.pointerValue);
            return "vt=" + pv.vt;
        } finally {
            PropVariantClear(ref pv);
        }
    }
}
"@

Add-Type -TypeDefinition $cs -ErrorAction Stop
[ZcordShortcut2]::Create($ShortcutPath, $ExePath, $WorkingDirectory, $IconPath, $AppUserModelId, "Zcord", $Arguments)
$read = [ZcordShortcut2]::ReadAumid($ShortcutPath)
if ($read -ne $AppUserModelId) {
    throw "AUMID not persisted. Got: $read"
}
Write-Host "OK $ShortcutPath AUMID=$read"
