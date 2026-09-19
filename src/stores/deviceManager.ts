import { useToast } from '@/components/ui/toast';
import useActiveProfile from '@/composables/activeProfile';
import type { ButtonBinding, Config, DeviceInfo, GameModeConfig, MeleeOptions, ProjectMOptions } from '@/lib/config';
import type { ConnectionManager, ConnectionState } from '@/lib/device';
import { EmulatedSerialDeviceManager, SerialDeviceManager, SerialNotSupportedError } from '@/lib/haybox/device';
import { type Layout, getLayouts } from '@/lib/layout';
import { type GameMode } from '@/lib/modes';
import type { SocdPair } from '@/lib/socd';
import { TimeoutError, withTimeout } from '@/lib/utils';
import type { ArgumentsType } from '@vueuse/core';
import type { HayBoxDevice } from 'haybox-webserial';
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, shallowRef, watch } from 'vue';

const SERIAL_READ_TIMEOUT_MS = 2000;

type Cb = () => void;

export const useDeviceManager = defineStore('device_manager', () => {
  const state = shallowRef<ConnectionState>('disconnected');

  watch(state, (newState, oldState) => {
    if (newState === 'disconnected') {
      config.value = null;
      info.value = null;
      originalConfig.value = null;
      layout.value = null;

      serial.value = null;
      manager.value = null;

      if (oldState === 'connected') {
        notifyDisconnected();
      }
    }
  });

  const manager = shallowRef<ConnectionManager | null>(null);

  const config = shallowRef<Config | null>(null);
  const info = shallowRef<DeviceInfo | null>(null);

  const originalConfig = shallowRef<Config | null>(null);

  const layout = shallowRef<Layout | null>(null);

  const serial = shallowRef<HayBoxDevice | null>(null);

  const noLayoutFoundCallbacks: Cb[] = [];

  function onNoLayoutFound(callback: Cb) {
    noLayoutFoundCallbacks.push(callback);
  }

  function notifyNoLayoutFound() {
    console.debug('device::notifyNoLayoutFound');

    for (const cb of noLayoutFoundCallbacks) {
      cb();
    }
  }

  async function loadDeviceData() {
    if (state.value !== 'connected' || manager.value == null) return;

    console.info('loading device info');

    try {
      info.value = await withTimeout(manager.value.getDeviceInfo(), SERIAL_READ_TIMEOUT_MS);

      if (info.value == null) {
        console.error('failed to get device info');
        const { toast } = useToast();
        toast({
          variant: 'destructive',
          title: 'Failed to get device info',
        });

        return;
      }

      await loadDeviceLayout(info.value.deviceName);

      if (!layout.value) {
        console.warn('no layout found for device:', info.value?.deviceName);

        notifyNoLayoutFound();

        return;
      }
    } catch (e) {
      await disconnect();

      if (e instanceof TimeoutError) {
        console.error('timed out getting device info');

        const { toast } = useToast();
        toast({
          variant: 'destructive',
          title: 'Failed to get device info',
          description: `Connection timed out after ${e.ms}ms`,
        });

        return;
      }

      console.error('failed to get device info:\n', e);

      const { toast } = useToast();
      toast({
        variant: 'destructive',
        title: 'Failed to read device info',
        description: 'Check the console for more details',
      });

      return;
    }

    loadDeviceConfig();

    notifyConnected();
  }

  async function loadDeviceConfig() {
    if (state.value !== 'connected' || manager.value == null || !layout.value) return;

    try {
      config.value = await withTimeout(manager.value.getConfig(layout.value), SERIAL_READ_TIMEOUT_MS);

      originalConfig.value = config.value ? config.value : null;

      console.debug('device info:', info.value);
      console.debug('device config:', config.value);
    } catch (e) {
      await disconnect();

      console.error('failed to get device config', e);

      const { toast } = useToast();
      toast({
        variant: 'destructive',
        title: 'Failed to read device config',
        description: 'Check the console for more details',
      });

      return;
    }
  }

  const modes = computed<Map<GameMode, GameModeConfig>>(() => {
    if (!config.value) return new Map();

    return new Map(config.value.gameModes.map((mode) => [mode.id, mode]));
  });

  async function loadDeviceLayout(name: string) {
    const layouts = await getLayouts();

    for (const [_, l] of layouts) {
      if (l.deviceName != null) {
        if (l.deviceName === name) {
          layout.value = l;
          break;
        }
      } else if (l.pattern?.test(name)) {
        layout.value = l;
        break;
      }
    }

    if (!layout.value) {
      const allLayouts = [...layouts.values()];
      console.warn(
        'no layout found for device:',
        `\`${name}\`,`,
        'tested:',
        allLayouts.map((l) => l.deviceName),
        allLayouts.map((l) => l.pattern),
      );
    }
  }

  async function overrideLayout(newLayout: Layout) {
    layout.value = newLayout;

    await loadDeviceConfig();

    notifyConnected();
  }

  async function onConfigChanged() {
    if (!config.value || !info.value) return;

    const activeProfile = useActiveProfile();
    activeProfile.value = config.value.defaultMode;

    await loadDeviceLayout(info.value.deviceName);

    notifyConfigLoaded(config.value);
  }

  watch([config, info], onConfigChanged, { immediate: true });

  async function saveConfig(): Promise<boolean> {
    if (manager.value == null || !config.value || !layout.value) return false;

    // Set the default mode to the current active profile
    const activeProfile = useActiveProfile();
    if (activeProfile.value) {
      config.value.defaultMode = activeProfile.value;
    }

    writeRemaps();
    writeOptions();

    try {
      if (await manager.value.setConfig(layout.value, config.value)) {
        originalConfig.value = { ...config.value };
        notifyConfigSaved();
        const { toast } = useToast();
        toast({
          title: 'Config saved successfully',
          description: 'Device configuration has been updated',
        });
        return true;
      }
    } catch (e) {
      console.error('failed to save config', e);
      const { toast } = useToast();
      toast({
        variant: 'destructive',
        title: 'Failed to save config',
        description: 'Check the console for more details',
      });
    }

    console.error('failed to save config');
    const { toast } = useToast();
    toast({
      variant: 'destructive',
      title: 'Failed to save config',
    });

    return false;
  }

  function clearMappings(mode: GameMode) {
    if (!config.value) return;

    const i = config.value.gameModes.findIndex((c) => c.id === mode);
    config.value.gameModes[i].buttonRemapping = [];
  }

  // #region connecting

  async function connectEmulated() {
    manager.value = new EmulatedSerialDeviceManager();
    await connectManager();
    if (manager.value) {
      serial.value = (manager.value as EmulatedSerialDeviceManager).getHayboxDevice();
    }
  }

  async function connect() {
    manager.value = new SerialDeviceManager();
    await connectManager();
    if (manager.value) {
      serial.value = (manager.value as SerialDeviceManager).getHayboxDevice();
    }
  }

  async function disconnect() {
    if (manager.value == null) return;

    try {
      await manager.value.disconnect();
    } catch (e) {
      console.error('failed to disconnect', e);
    }
  }

  async function connectManager() {
    try {
      await manager.value?.connect((newState) => {
        state.value = newState;
      });

      await loadDeviceData();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') {
        return;
      }

      const { toast } = useToast();

      const toastOptions: ArgumentsType<typeof toast>[0] = {
        variant: 'destructive',
        title: 'Failed to connect',
      };

      if (e instanceof SerialNotSupportedError) {
        console.error('Web Serial API not supported');
        toast({
          ...toastOptions,
          title: 'Web Serial API not supported',
        });

        return;
      }

      console.error('failed to connect', e);

      if (e instanceof Error) {
        toast({
          ...toastOptions,
          description: e.message,
        });

        return;
      }

      toast({
        ...toastOptions,
        description: 'Check the console for more details',
      });
    }
  }

  function reboot() {
    if (state.value !== 'connected' || manager.value == null) return;

    manager.value.reboot();
  }

  function rebootToBootloader() {
    if (state.value !== 'connected' || manager.value == null) return;

    manager.value.rebootToBootloader();
  }

  const connectedCallbacks: Cb[] = [];

  function onConnected(callback: Cb) {
    connectedCallbacks.push(callback);
  }

  function notifyConnected() {
    console.debug('device::notifyConnected');

    for (const cb of connectedCallbacks) {
      cb();
    }
  }

  const disconnectedCallbacks: Cb[] = [];

  function onDisconnected(callback: Cb) {
    disconnectedCallbacks.push(callback);
  }

  function notifyDisconnected() {
    console.debug('device::notifyDisconnected');

    for (const cb of disconnectedCallbacks) {
      cb();
    }
  }

  // #endregion

  // #region config loaded

  const configLoadedCallbacks: ((config: Config) => void)[] = [];

  function onConfigLoaded(callback: (config: Config) => void) {
    configLoadedCallbacks.push(callback);
  }

  function notifyConfigLoaded(config: Config) {
    console.debug('device::notifyConfigLoaded');

    for (const cb of configLoadedCallbacks) {
      cb(config);
    }
  }

  // #endregion

  // #region config saved

  const configSavedCallbacks: Cb[] = [];

  function onConfigSaved(callback: Cb) {
    configSavedCallbacks.push(callback);
  }

  function notifyConfigSaved() {
    console.debug('device::notifyConfigSaved');

    for (const cb of configSavedCallbacks) {
      cb();
    }
  }

  // #endregion

  // #region remap

  type RemappedConfig = {
    mode: GameMode;
    buttons: ButtonBinding[];
    socd: SocdPair[];
  };

  type ConfigWriteCb = () => RemappedConfig;

  const requestRemappedCallbacks: ConfigWriteCb[] = [];

  function onRequestRemapped(callback: ConfigWriteCb) {
    requestRemappedCallbacks.push(callback);
  }

  function writeRemaps() {
    if (!config.value) return;
    console.debug('device::writeRemaps');

    console.info('remapping config:', config.value);

    for (const getModifiedMappings of requestRemappedCallbacks) {
      const remapped = getModifiedMappings();

      console.info('remapped config:', remapped);

      const i = config.value.gameModes.findIndex((c) => c.id === remapped.mode);

      if (i === -1) {
        console.error('[device::writeRemaps] mode not found', remapped.mode);
        continue;
      }

      config.value.gameModes[i].buttonRemapping = remapped.buttons;
      config.value.gameModes[i].socdPairs = remapped.socd;
    }
  }

  // #endregion

  // #region options

  type AllOptions = {
    meleeOptions: MeleeOptions;
    projectMOptions: ProjectMOptions;
  };

  type OptionsWriteCb = () => AllOptions;

  const requestOptionsCallbacks: OptionsWriteCb[] = [];

  function onRequestOptions(callback: OptionsWriteCb) {
    requestOptionsCallbacks.push(callback);
  }

  function writeOptions() {
    if (!config.value) return;
    console.debug('device::writeOptions');

    console.info('remapping options:', config.value);

    for (const getModifiedOptions of requestOptionsCallbacks) {
      const modified = getModifiedOptions();

      console.info('remapped options:', modified);

      config.value.meleeOptions = modified.meleeOptions;
      config.value.projectMOptions = modified.projectMOptions;
    }
  }

  // #endregion

  return {
    state,

    config,
    info,

    originalConfig,

    layout,
    overrideLayout,
    onNoLayoutFound,

    modes,

    clearMappings,

    connect,
    connectEmulated,
    disconnect,

    reboot,
    rebootToBootloader,

    onConnected,
    onDisconnected,

    saveConfig,

    onConfigLoaded,
    onConfigSaved,
    onRequestRemapped,
    onRequestOptions,

    // todo: something better
    serial,
  };
});

// https://pinia.vuejs.org/cookbook/hot-module-replacement.html
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDeviceManager, import.meta.hot));
}
