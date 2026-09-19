import { bindingToPhysical, physicalToBinding } from '@/lib/bindings';
import type { ButtonBinding, Config, DeviceInfo, GameModeConfig, MeleeOptions, ProjectMOptions } from '@/lib/config';
import { ConnectionManager, type ConnectionState } from '@/lib/device';
import { BUTTON_TO_HAYBOX, HAYBOX_TO_BUTTON } from '@/lib/haybox/buttons';
import { EmulatedDevice } from '@/lib/haybox/emulated';
import { HAYBOX_TO_MODE, MODE_TO_HAYBOX } from '@/lib/haybox/modes';
import { HAYBOX_TO_SOCD, SOCD_TO_HAYBOX } from '@/lib/haybox/socd';
import type { Layout } from '@/lib/layout';
import type { GameMode } from '@/lib/modes';
import type { SocdPair } from '@/lib/socd';
import * as hb from 'haybox-webserial';

export class SerialNotSupportedError extends Error {
  constructor() {
    super('Web Serial API not supported.');
  }
}

export class SerialDeviceManager extends ConnectionManager {
  protected stateCb: ((state: ConnectionState) => void) | undefined;

  protected port: SerialPort | null = null;

  protected device: hb.HayBoxDevice | null = null;

  public getHayboxDevice(): hb.HayBoxDevice | null {
    return this.device;
  }

  /* only kept to not lose settings that arent included in the internal config */
  private config: hb.Config | null = null;

  protected setState(state: ConnectionState) {
    if (this.stateCb) this.stateCb(state);
  }

  public async connect(stateCb: (state: ConnectionState) => void): Promise<void> {
    this.stateCb = stateCb;

    this.setState('disconnected');
    this.port = null;
    this.device = null;

    if (!('serial' in navigator)) {
      this.device = null;
      throw new SerialNotSupportedError();
    }

    this.setState('connecting');

    try {
      const newPort = await navigator.serial.requestPort();

      console.debug('[serial::connect] new port', newPort);

      this.setState('connected');

      this.port = newPort;
      this.port.ondisconnect = () => {
        console.debug('[serial::connect] port disconnected');
      };
      this.device = new hb.HayBoxDevice(this.port);
    } catch (err) {
      this.setState('disconnected');
      throw err;
    }
  }

  public async disconnect() {
    this.device = null;

    if (this.port?.connected) {
      try {
        await this.port?.close();
      } catch (err) {
        console.error('Error closing serial port:', err);
      }
    }

    this.port = null;

    this.setState('disconnected');
  }

  public async reboot(): Promise<void> {
    if (!this.device) return;

    await this.device.rebootFirmware();
    this.setState('disconnected');
  }

  public async rebootToBootloader(): Promise<void> {
    if (!this.device) return;

    await this.device.rebootBootloader();
    this.setState('disconnected');
  }

  public async getDeviceInfo(): Promise<DeviceInfo | null> {
    if (!this.device) return null;

    try {
      const info = await this.device.getDeviceInfo();

      if (!info) return null;

      return {
        deviceName: info.deviceName,
        firmwareName: info.firmwareName,
        firmwareVersion: info.firmwareVersion,
      };
    } catch (err) {
      console.error('Error getting device info:', err);
      return null;
    }
  }

  public async getConfig(layout: Layout): Promise<Config | null> {
    if (!this.device) return null;

    const config = await this.device.getConfig();

    if (!config) return null;

    this.config = config;

    const defaultBackendIdx = config.defaultBackendConfig;

    // indices are 1-based because protobuf moment
    const defaultModeIdx = config.communicationBackendConfigs[defaultBackendIdx - 1].defaultModeConfig;

    const defaultMode = config.gameModeConfigs[defaultModeIdx - 1];

    const projectMOptions = hayboxToInternalProjectMOptions(layout, config.projectMOptions);
    const meleeOptions = hayboxToInternalMeleeOptions(layout, config.meleeOptions);

    return {
      gameModes: config.gameModeConfigs.map((c) => hayboxToInternalGameMode(layout, c)),
      defaultMode: HAYBOX_TO_MODE[defaultMode.modeId],
      projectMOptions,
      meleeOptions,
    };
  }

  public async setConfig(layout: Layout, config: Config): Promise<boolean> {
    if (!this.device || !this.config) return false;

    this.config.gameModeConfigs = config.gameModes.map((mode) => internalToHayboxGameMode(this.config, layout, mode));

    // Update the default mode in device config
    const defaultModeConfig = this.config.gameModeConfigs.findIndex(gc => 
      HAYBOX_TO_MODE[gc.modeId] === config.defaultMode
    ) + 1; // Convert to 1-based index
    
    // Set default mode for all backends
    for (const backendConfig of this.config.communicationBackendConfigs) {
      backendConfig.defaultModeConfig = defaultModeConfig;
    }

    this.config.projectMOptions = internalToHayboxProjectMOptions(config.projectMOptions);
    this.config.meleeOptions = internalToHayboxMeleeOptions(config.meleeOptions);

    return await this.device.setConfig(this.config);
  }
}

function hayboxToInternalSocd(layout: Layout, mode_id: hb.GameModeId, pair: hb.SocdPair): SocdPair {
  const mode = HAYBOX_TO_MODE[mode_id];
  return {
    a: physicalToBinding(layout, mode, HAYBOX_TO_BUTTON[pair.buttonDir1]),
    b: physicalToBinding(layout, mode, HAYBOX_TO_BUTTON[pair.buttonDir2]),
    type: HAYBOX_TO_SOCD[pair.socdType],
  };
}

function hayboxToInternalButtonBinding(layout: Layout, mode: hb.GameModeId, remap: hb.ButtonRemap): ButtonBinding {
  return {
    physical: HAYBOX_TO_BUTTON[remap.physicalButton],
    binding: physicalToBinding(layout, HAYBOX_TO_MODE[mode], HAYBOX_TO_BUTTON[remap.activates]),
  };
}

function hayboxToInternalGameMode(layout: Layout, config: hb.GameModeConfig): GameModeConfig {
  return {
    id: HAYBOX_TO_MODE[config.modeId],
    name: config.name,
    socdPairs: config.socdPairs.map((pair) => hayboxToInternalSocd(layout, config.modeId, pair)),
    activationBinding: config.activationBinding.map((b) => HAYBOX_TO_BUTTON[b]),
    buttonRemapping: config.buttonRemapping.map((br) => hayboxToInternalButtonBinding(layout, config.modeId, br)),
  };
}

function internalToHayboxGameMode(config: hb.Config | null, layout: Layout, mode: GameModeConfig): hb.GameModeConfig {
  if (mode.name == null) {
    throw new Error('Game mode name cannot be null');
  }

  const previous = config?.gameModeConfigs.find((c) => c.modeId === MODE_TO_HAYBOX[mode.id]) ?? new hb.GameModeConfig();

  return new hb.GameModeConfig({
    modeId: MODE_TO_HAYBOX[mode.id],
    name: mode.name,
    socdPairs: mode.socdPairs.map((pair) => internalToHayboxSocd(layout, mode.id, pair)),
    activationBinding: mode.activationBinding.map((b) => BUTTON_TO_HAYBOX[b]),
    buttonRemapping: mode.buttonRemapping.map((b) => internalToHayboxButtonBinding(layout, mode.id, b)),
    customModeConfig: previous.customModeConfig,
    keyboardModeConfig: previous.keyboardModeConfig,
    rgbConfig: previous.rgbConfig,
  });
}

function internalToHayboxSocd(layout: Layout, mode: GameMode, pair: SocdPair): hb.SocdPair {
  return new hb.SocdPair({
    buttonDir1: BUTTON_TO_HAYBOX[bindingToPhysical(layout, mode, pair.a)],
    buttonDir2: BUTTON_TO_HAYBOX[bindingToPhysical(layout, mode, pair.b)],
    socdType: SOCD_TO_HAYBOX[pair.type],
  });
}

function internalToHayboxButtonBinding(layout: Layout, mode: GameMode, binding: ButtonBinding): hb.ButtonRemap {
  return new hb.ButtonRemap({
    physicalButton: BUTTON_TO_HAYBOX[binding.physical],
    activates: BUTTON_TO_HAYBOX[bindingToPhysical(layout, mode, binding.binding)],
  });
}

function internalToHayboxProjectMOptions({
  enabled,
  trueZPress,
  disableLedgedashSocdOverride,
  customAirdodge,
}: ProjectMOptions): hb.ProjectMOptions | undefined {
  if (!enabled) return undefined;

  const clampCoord = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

  const airdodge =
    customAirdodge == null
      ? undefined
      : new hb.Coords({ x: clampCoord(customAirdodge.x), y: clampCoord(customAirdodge.y) });

  return new hb.ProjectMOptions({
    trueZPress,
    disableLedgedashSocdOverride,
    customAirdodge: airdodge,
  });
}

function hayboxToInternalProjectMOptions(layout: Layout, options?: hb.ProjectMOptions): ProjectMOptions {
  if (options == null) return layout.projectMOptions;

  const airdodge = options.customAirdodge == null ? null : { x: options.customAirdodge.x, y: options.customAirdodge.y };

  return {
    enabled: true,
    trueZPress: options.trueZPress,
    disableLedgedashSocdOverride: options.disableLedgedashSocdOverride,
    customAirdodge: airdodge,
  };
}

function internalToHayboxMeleeOptions({
  enabled,
  crouchWalkOs,
  disableLedgedashSocdOverride,
  customAirdodge,
}: MeleeOptions): hb.MeleeOptions | undefined {
  if (!enabled) return undefined;

  const clampCoord = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

  const airdodge =
    customAirdodge == null
      ? undefined
      : new hb.Coords({ x: clampCoord(customAirdodge.x), y: clampCoord(customAirdodge.y) });

  return new hb.MeleeOptions({
    crouchWalkOs,
    disableLedgedashSocdOverride,
    customAirdodge: airdodge,
  });
}

function hayboxToInternalMeleeOptions(layout: Layout, options?: hb.MeleeOptions): MeleeOptions {
  if (options == null) return layout.meleeOptions;

  const airdodge = options.customAirdodge == null ? null : { x: options.customAirdodge.x, y: options.customAirdodge.y };

  return {
    enabled: true,
    crouchWalkOs: options.crouchWalkOs,
    disableLedgedashSocdOverride: options.disableLedgedashSocdOverride,
    customAirdodge: airdodge,
  };
}

export class EmulatedSerialDeviceManager extends SerialDeviceManager {
  public connect(stateCb: (state: ConnectionState) => void): Promise<void> {
    this.stateCb = stateCb;
    this.device = new EmulatedDevice();
    this.setState('connected');
    return Promise.resolve();
  }

  public async disconnect() {
    this.device = null;
    this.setState('disconnected');

    await Promise.resolve();
  }

  public async reboot(): Promise<void> {
    await super.reboot();

    // emulate disconnect
    this.setState('disconnected');
  }

  public async rebootToBootloader(): Promise<void> {
    await super.rebootToBootloader();

    // emulate disconnect
    this.setState('disconnected');
  }
}
