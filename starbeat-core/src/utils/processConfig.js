import Plist from "./plist";

const sleep = (time = 0) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
};

const processConfig = async (workspace, saveFile, barebones, options) => {
  const path = window.require("path"),
    fs = window.require("fs"),
    userDir = window.electron.getUserDir(),
    extPath = path.join(userDir, ".tfu");

  try {
    // extract OpenCore.zip
    window.electron.unzip(saveFile, path.join(workspace, "OpenCore"));
    let extractPath;
    fs.readdirSync(`${workspace}/OpenCore`).forEach((path) => {
      if (path.indexOf("ayamita") >= 0 || path.indexOf("hasee-tongfang-macos") >= 0)
        extractPath = path;
      else extractPath = ``;
    });

    // remove legacy directories
    window.electron.rmdir(`${workspace}/BOOT`);
    window.electron.rmdir(`${workspace}/OC`);
    await sleep(500);

    // move new directories
    await fs.rename(`${workspace}/OpenCore/${extractPath}/BOOT`, `${workspace}/BOOT`, () => {});
    await fs.rename(`${workspace}/OpenCore/${extractPath}/OC`, `${workspace}/OC`, () => {});
    await sleep(500);
    await fs.rename(
      `${workspace}/OpenCore/${extractPath}/Docs/Credits.md`,
      `${workspace}/OC/Credits.md`,
      () => {}
    );
    await sleep(500);
    window.electron.rmdir(`${workspace}/OpenCore`);

    // move accessibility voiceover package
    if (options.accessibility) {
      window.electron.rmdir(`${workspace}/OC/Resources/Audio`);
      await sleep(500);
      window.electron.copyDir(path.join(extPath, "Audio"), `${workspace}/OC/Resources/Audio`);
    }

    // modify configs
    const OCPath = path.join(workspace, "OC");
    const content = window.electron.readFile(path.join(OCPath, "config.plist"));
    const plist = new Plist(content);

    // remove ssdt-uiac-files
    const ACPIPath = path.join(OCPath, "ACPI");
    const deleteUIAC = (reserve) => {
      const files = fs.readdirSync(ACPIPath);
      files.forEach((file) => {
        if (file.includes("SSDT-UIAC") && file !== reserve)
          fs.unlinkSync(path.join(ACPIPath, file));
      });
      fs.renameSync(path.join(ACPIPath, reserve), path.join(ACPIPath, "SSDT-UIAC.aml"));
    };

    // model customize
    switch (barebones[options.laptop]) {
      case "GK5CN5X":
      case "GK5CN6X":
      case "GK7CN6S":
      default:
        deleteUIAC("SSDT-UIAC.aml");
        break;
      case "GK5CN6Z":
        deleteUIAC("SSDT-UIAC-GK5CN6Z.aml");
        break;
      case "GJ5CN64":
      case "GI5CN54":
        deleteUIAC(`SSDT-UIAC-${barebones[options.laptop]}.aml`);
        plist.setAllKexts(["VoodooI2C", "VoodooGPIO"], false);
        plist.setKext("VoodooPS2Controller.kext/Contents/PlugIns/VoodooInput", true);
        plist.setSSDT("SSDT-USTP", false);
        break;
      case "GK7CP6R":
      case "GK5CP6V":
      case "GK5CP5V":
      case "GK5CR0V":
        deleteUIAC("SSDT-UIAC-GK7CP6R.aml");
        options.appleGuC = true;
        plist.setACPIPatch("RTC: enable", true);
        break;
      case "GK5CP6X":
      case "GK5CP6Z":
        deleteUIAC("SSDT-UIAC-GK5CP6X.aml");
        options.appleGuC = true;
        plist.setACPIPatch("RTC: enable", true);
        break;
    }

    // wireless card
    switch (options.wirelessCard) {
      case "apple":
        plist.setKext("AirportBrcmFixup", true);
        if (navigator.language === "zh-CN") plist.setBootArg("brcmfx-country=CN");
        else plist.setBootArg("brcmfx-country=#a");
        break;
      case "broadcom":
        plist.setAllKexts(
          ["AirportBrcmFixup", "BrcmBluetoothInjector", "BrcmFirmwareData", "BrcmPatchRAM3"],
          true
        );
        if (navigator.language === "zh-CN") plist.setBootArg("brcmfx-country=CN");
        else plist.setBootArg("brcmfx-country=#a");
        break;
      case "intel":
      default:
        window.electron.copyDir(
          path.join(extPath, "IntelBluetoothFirmware.kext"),
          `${workspace}/OC/Kexts/IntelBluetoothFirmware.kext`
        );
        window.electron.copyDir(
          path.join(extPath, "IntelBluetoothInjector.kext"),
          `${workspace}/OC/Kexts/IntelBluetoothInjector.kext`
        );
        plist.setKext("IntelBluetooth", true);

        if (!options.useAirportItlwm) {
          window.electron.copyDir(
            path.join(extPath, "itlwm.kext"),
            `${workspace}/OC/Kexts/itlwm.kext`
          );
          plist.setKext("itlwm.kext", true);
        } else {
          if (options.osVersion === "catalina") {
            window.electron.copyDir(
              path.join(extPath, "AirportItlwm-Catalina.kext"),
              `${workspace}/OC/Kexts/AirportItlwm-Catalina.kext`
            );
            plist.setKext("AirportItlwm-Catalina", true);
          } else {
            window.electron.copyDir(
              path.join(extPath, "AirportItlwm-BigSur.kext"),
              `${workspace}/OC/Kexts/AirportItlwm-BigSur.kext`
            );
            plist.setKext("AirportItlwm-BigSur", true);
          }
        }
        break;
    }

    if (options.rndis) plist.setKext("HoRNDIS", true);
    if (options.disableNVMe) {
      plist.setSSDT("SSDT-DNVME", true);
      plist.setBootArg("-nvme-disabled");
    }
    if (options.accessibility) plist.setValue("Misc/Boot/PickerMode", "Builtin");
    if (!options.bootChime && !options.accessibility) {
      plist.setValue("Misc/Boot/PickerAudioAssist", false);
      plist.setValue("UEFI/Audio/PlayChime", false);
      plist.setValue("UEFI/Audio/AudioSupport", false);
      plist.deleteValue("UEFI/Drivers/4");
    }

    if (options.osVersion === "bigsur")
      plist.setValue(
        "NVRAM/Add/7C436110-AB2A-4BBB-A880-FE41995C9F82/csr-active-config",
        new Uint8Array([119, 0, 0, 0])
      );

    if (options.cpuBestPerformance) {
      plist.setKext("CPUFriendDataProvider.kext", false);
      plist.setKext("CPUFriendDataProvider_Performance.kext", true);
    }

    if (options.resolution === "4k") {
      plist.setProperties(
        "PciRoot(0x0)/Pci(0x2,0x0)",
        "enable-dpcd-max-link-rate-fix",
        new Uint8Array([1, 0, 0, 0])
      );
      plist.setProperties(
        "PciRoot(0x0)/Pci(0x2,0x0)",
        "framebuffer-con1-alldata",
        new Uint8Array([1, 5, 9, 0, 0, 4, 0, 0, 135, 1, 0, 0])
      );
      plist.setProperties(
        "PciRoot(0x0)/Pci(0x2,0x0)",
        "framebuffer-unifiedmem",
        new Uint8Array([0, 0, 0, 192])
      );
      plist.deleteProperties("PciRoot(0x0)/Pci(0x2,0x0)", "framebuffer-con0-enable");
      plist.deleteProperties("PciRoot(0x0)/Pci(0x2,0x0)", "framebuffer-con0-pipe");
      plist.deleteProperties("PciRoot(0x0)/Pci(0x2,0x0)", "framebuffer-con1-pipe");
      plist.deleteProperties("PciRoot(0x0)/Pci(0x2,0x0)", "framebuffer-con2-enable");
      plist.deleteProperties("PciRoot(0x0)/Pci(0x2,0x0)", "framebuffer-con2-pipe");
      plist.deleteProperties("PciRoot(0x0)/Pci(0x2,0x0)", "framebuffer-stolenmem");
      plist.deleteProperties("PciRoot(0x0)/Pci(0x2,0x0)", "framebuffer-fbmem");
      plist.setValue("NVRAM/Add/4D1EDE05-38C7-4A6A-9CC6-4BCCA8B38C14/UIScale", new Uint8Array([2]));
      plist.setBootArg("-cdfon -igfxmlr");
    }

    if (options.appleGuC) plist.setBootArg("igfxfw=2");
    if (options.NVMeFix) plist.setKext("NVMeFix", true);

    plist.setValue("PlatformInfo/Generic/SystemProductName", options.model);
    plist.setValue("PlatformInfo/Generic/SystemSerialNumber", options.sn);
    plist.setValue("PlatformInfo/Generic/MLB", options.mlb);
    plist.setValue("PlatformInfo/Generic/SystemUUID", options.smuuid);
    
    // record model info
    plist.setValue("NVRAM/Add/7C436110-AB2A-4BBB-A880-FE41995C9F82/efi-model", options.laptop);

    if (navigator.language !== "zh-CN") {
      plist.setValue("NVRAM/Add/7C436110-AB2A-4BBB-A880-FE41995C9F82/prev-lang:kbd", "en-US:0");
    }

    window.electron.writeFile(path.join(path.join(workspace, "OC"), "config.plist"), plist.buildPlist());
    fs.unlinkSync(path.join(workspace, "OpenCore.zip"));
    return true;
  } catch (err) {
    console.err(err);
    return false;
  }
};

export default processConfig;
