#!/usr/bin/env python3
"""Build daytime's Android APK with the SDK tools only — no Gradle required.

    python android/build.py             debug-signed, for quick installs
    python android/build.py --release   release-signed, for sharing

It runs the same steps Gradle would (aapt2 → javac → d8 → zipalign →
apksigner) against $ANDROID_HOME, so it works offline and needs nothing from
Maven.

The debug build is signed with the standard Android debug certificate, which
Play Protect treats as an untrusted test build. `--release` creates (once) a
private release keystore in android/ and signs with that instead.

Open the `android` folder in Android Studio instead if you prefer Gradle; the
manifest/resources/sources are a standard single-module layout.
"""
from __future__ import annotations

import os
import re
import secrets
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP = ROOT / "app" / "src" / "main"
BUILD = ROOT / "build"
PACKAGE = "com.daytime.app"
MIN_SDK = "26"
TARGET_SDK = "36"
VERSION_CODE = "6"
VERSION_NAME = "1.0.5"
RELEASE = "--release" in sys.argv
SAFE_ALARMS = "--safe-alarms" in sys.argv
CUSTOM_PACKAGE = None
if "--package" in sys.argv:
    CUSTOM_PACKAGE = sys.argv[sys.argv.index("--package") + 1]
if SAFE_ALARMS and CUSTOM_PACKAGE:
    OUTPUT_NAME = "daytime-safe.apk"
elif RELEASE:
    OUTPUT_NAME = "daytime-release.apk"
else:
    OUTPUT_NAME = "daytime-debug.apk"


def die(message: str) -> "typing.NoReturn":
    raise SystemExit(message)


def find_sdk() -> Path:
    for key in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        value = os.environ.get(key)
        if value and (Path(value) / "platforms").is_dir():
            return Path(value)
    default = Path(os.environ.get("LOCALAPPDATA", "")) / "Android" / "Sdk"
    if default.is_dir():
        return default
    die("Android SDK not found. Set ANDROID_HOME to your SDK folder.")


def version_key(path: Path) -> tuple:
    return tuple(int(part) if part.isdigit() else 0 for part in re.split(r"[.\-]", path.name))


def latest_build_tools(sdk: Path) -> Path:
    entries = [p for p in (sdk / "build-tools").iterdir() if p.is_dir()]
    if not entries:
        die("No build-tools installed in the Android SDK.")
    return max(entries, key=version_key)


def pick_platform(sdk: Path) -> Path:
    entries = [p for p in (sdk / "platforms").iterdir() if p.is_dir()]
    if not entries:
        die("No Android platform installed in the SDK.")
    stable = [p for p in entries if p.name == "android-36"] or entries
    return max(stable, key=version_key)


def tool(path: Path, name: str) -> Path:
    for suffix in ("", ".exe", ".bat"):
        candidate = path / (name + suffix)
        if candidate.is_file():
            return candidate
    die(f"Missing {name} in {path}")


def prepare_manifest() -> Path:
    """Optional manifest variants for installs that trip device scanners."""
    text = (APP / "AndroidManifest.xml").read_text(encoding="utf-8")

    if SAFE_ALARMS:
        text = text.replace(
            '    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />\n', ""
        )
        for attribute in (
            "showOnLockScreen",
            "showWhenLocked",
            "turnScreenOn",
            "excludeFromRecents",
            "launchMode",
        ):
            text = re.sub(rf'android:{attribute}="[^"]*"\s*', "", text)

    if CUSTOM_PACKAGE:
        text = text.replace('package="com.daytime.app"', f'package="{CUSTOM_PACKAGE}"')
        for component in ("MainActivity", "AlarmActivity", "AlarmReceiver", "DaytimeWidgetProvider"):
            text = text.replace(
                f'android:name=".{component}"',
                f'android:name="com.daytime.app.{component}"',
            )

    target = BUILD / "AndroidManifest.variant.xml"
    target.write_text(text, encoding="utf-8")
    return target


def run(args, **kwargs) -> None:
    printable = " ".join(str(arg) for arg in args)
    print(f"  $ {printable}")
    subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def main() -> None:
    sdk = find_sdk()
    build_tools = latest_build_tools(sdk)
    platform = pick_platform(sdk)
    android_jar = platform / "android.jar"
    if not android_jar.is_file():
        die(f"Missing {android_jar}")

    aapt2 = tool(build_tools, "aapt2")
    zipalign = tool(build_tools, "zipalign")
    d8_jar = build_tools / "lib" / "d8.jar"
    apksigner_jar = build_tools / "lib" / "apksigner.jar"
    java = shutil.which("java") or die("java is not on PATH (install a JDK 17).")
    javac = shutil.which("javac") or die("javac is not on PATH (install a JDK 17).")
    jar = shutil.which("jar") or die("jar is not on PATH (install a JDK 17).")
    keytool = shutil.which("keytool") or die("keytool is not on PATH (install a JDK 17).")

    print(f"SDK        {sdk}")
    print(f"build-tools {build_tools.name}")
    print(f"platform   {platform.name}")

    if BUILD.exists():
        # Keep previously built APKs so the normal and safe variants can coexist.
        for child in BUILD.iterdir():
            if child.suffix in (".apk", ".idsig"):
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    else:
        BUILD.mkdir(parents=True)
    (BUILD / "gen").mkdir(parents=True, exist_ok=True)
    (BUILD / "classes").mkdir(exist_ok=True)
    (BUILD / "dex").mkdir(exist_ok=True)

    print("\n[1/7] compiling resources")
    run([aapt2, "compile", "--dir", APP / "res", "-o", BUILD / "res.zip"])

    print("\n[2/7] linking resources")
    manifest = prepare_manifest()
    link_args = [
        aapt2, "link",
        "-o", BUILD / "base.apk",
        "-I", android_jar,
        "--manifest", manifest,
        "-R", BUILD / "res.zip",
        "--auto-add-overlay",
        "--java", BUILD / "gen",
        "--min-sdk-version", MIN_SDK,
        "--target-sdk-version", TARGET_SDK,
        "--version-code", VERSION_CODE,
        "--version-name", VERSION_NAME,
    ]
    if CUSTOM_PACKAGE:
        # Keep R.java in the Java package while the APK identity changes.
        link_args += ["--custom-package", "com.daytime.app"]
    run(link_args)

    print("\n[3/7] compiling Java")
    sources = sorted(str(path) for path in (APP / "java").rglob("*.java"))
    sources += sorted(str(path) for path in (BUILD / "gen").rglob("*.java"))
    if not sources:
        die("No Java sources found.")
    run([
        javac,
        "-encoding", "UTF-8",
        "-source", "11", "-target", "11", "-Xlint:-options",
        "-classpath", android_jar,
        "-d", BUILD / "classes",
    ] + sources)

    print("\n[4/7] dexing")
    run([jar, "cf", BUILD / "classes.jar", "-C", BUILD / "classes", "."])
    run([
        java, "-cp", d8_jar, "com.android.tools.r8.D8",
        "--lib", android_jar,
        "--min-api", MIN_SDK,
        "--output", BUILD / "dex",
        BUILD / "classes.jar",
    ])

    dex = BUILD / "dex" / "classes.dex"
    if not dex.is_file():
        die("d8 did not produce classes.dex")
    with zipfile.ZipFile(BUILD / "base.apk", "a", zipfile.ZIP_DEFLATED) as apk:
        apk.write(dex, "classes.dex")

    print("\n[5/7] aligning")
    run([zipalign, "-f", "4", BUILD / "base.apk", BUILD / "aligned.apk"])

    print("\n[6/7] signing")
    if RELEASE:
        keystore = ROOT / "release.keystore"
        properties = ROOT / "keystore.properties"
        if not properties.is_file():
            password = secrets.token_urlsafe(18)
            properties.write_text(
                "# Used by `python android/build.py --release`. Keep this private.\n"
                f"storePassword={password}\n"
                f"keyPassword={password}\n"
                "keyAlias=daytime\n",
                encoding="utf-8",
            )
            print("  created android/keystore.properties")
        data = {}
        for line in properties.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                key, value = line.split("=", 1)
                data[key.strip()] = value.strip()
        alias = data.get("keyAlias", "daytime")
        store_password = data.get("storePassword", "")
        key_password = data.get("keyPassword", store_password)
        distinguished_name = "CN=daytime, O=daytime, C=IN"
        key_size = "4096"
    else:
        keystore = ROOT / "debug.keystore"
        alias = "androiddebugkey"
        store_password = key_password = "android"
        distinguished_name = "CN=Android Debug, O=Android, C=US"
        key_size = "2048"

    if not keystore.is_file():
        run([
            keytool, "-genkeypair", "-noprompt",
            "-keystore", keystore,
            "-storepass", store_password,
            "-alias", alias,
            "-keypass", key_password,
            "-keyalg", "RSA",
            "-keysize", key_size,
            "-validity", "10000",
            "-dname", distinguished_name,
        ])

    output = BUILD / OUTPUT_NAME
    run([
        java, "-jar", apksigner_jar, "sign",
        "--ks", keystore,
        "--ks-pass", f"pass:{store_password}",
        "--key-pass", f"pass:{key_password}",
        # Sign with every scheme Android knows. Play Protect's scanner is much
        # happier with a fully-signed APK; v1 also keeps older inspection tools
        # and some OEM installers from treating the file as unsigned.
        "--v1-signing-enabled", "true",
        "--v2-signing-enabled", "true",
        "--v3-signing-enabled", "true",
        "--out", output,
        BUILD / "aligned.apk",
    ])

    print("\n[7/7] verifying")
    run([java, "-jar", apksigner_jar, "verify", "--print-certs", output])
    run([aapt2, "dump", "badging", output], stdout=subprocess.DEVNULL)

    size_kb = output.stat().st_size / 1024
    print(f"\nBuilt {output.relative_to(ROOT.parent)}  ({size_kb:.0f} KB)")
    print("Install with: adb install -r " + str(output))


if __name__ == "__main__":
    sys.exit(main())
