import { useToast } from '@/components/ui/toast';
import type { Binding } from '@/lib/bindings';
import { PHYSICAL_BUTTON, type PhysicalButton } from '@/lib/buttons';
import type { GameMode } from '@/lib/modes';
import type { SocdType } from '@/lib/socd';
import { MAP_SERIALIZER, parseRegex, readFile } from '@/lib/utils';
import { DEFAULT_MELEE_OPTIONS, DEFAULT_PROJECT_M_OPTIONS, type MeleeOptions, type ProjectMOptions } from './config';

export type BindingVisibility = 'hidden';

export type ModeConfigResponse = {
  bindings?: ([number, Binding] | [number, Binding, BindingVisibility])[];
  socd?: [Binding, Binding, SocdType][];
};

export type LayoutResponse = {
  name: string;

  deviceName?: string;
  pattern?: string;

  viewport: [number, number];

  buttons?: [number, number, number][];
  modes?: Partial<{ [key in GameMode]: ModeConfigResponse }>;

  projectMOptions?: {
    trueZPress: boolean;
    disableLedgedashSocdOverride: boolean;
    customAirdodge?: [number, number];
  };

  meleeOptions?: {
    crouchWalkOs: boolean;
    disableLedgedashSocdOverride: boolean;
    customAirdodge?: [number, number];
  };
};

export type ModeConfig = {
  bindings: ([PhysicalButton, Binding] | [PhysicalButton, Binding, BindingVisibility])[];
  socd: [Binding, Binding, SocdType][];
};

export type Layout = {
  id: string;
  name: string;

  deviceName?: string;
  pattern?: RegExp;

  viewport: [number, number];

  buttons: [PhysicalButton, number, number][];
  modes: Partial<{ [key in GameMode]: ModeConfig }>;

  projectMOptions: ProjectMOptions;
  meleeOptions: MeleeOptions;
};

type Range<N extends number, R extends unknown[] = []> = R['length'] extends N
  ? R[number]
  : Range<N, [...R, R['length']]>;

export type PhysicalButtonExport = PhysicalButton | Range<60>;

export function exportPhysical(button: PhysicalButton): PhysicalButtonExport {
  if (button === PHYSICAL_BUTTON.UNSPECIFIED) {
    return 'unspecified';
  }

  return Number(button) as PhysicalButtonExport;
}

export type ModeConfigExport = {
  bindings?: ([PhysicalButtonExport, Binding] | [PhysicalButtonExport, Binding, BindingVisibility])[];
  socd?: [Binding, Binding, SocdType][];
};

export function exportModeConfig(data: ModeConfig): ModeConfigExport {
  return {
    bindings: data.bindings.map(([b, x, v]) => (v ? [exportPhysical(b), x, v] : [exportPhysical(b), x])),
    socd: data.socd,
  };
}

type Coords = [number, number];

export type ProjectMOptionsExport = {
  trueZPress: boolean;
  disableLedgedashSocdOverride: boolean;
  customAirdodge?: Coords;
};

export type MeleeOptionsExport = {
  crouchWalkOs: boolean;
  disableLedgedashSocdOverride: boolean;
  customAirdodge?: Coords;
};

export function exportProjectMOptions(data: ProjectMOptions): ProjectMOptionsExport | undefined {
  if (!data.enabled) return undefined;

  return {
    trueZPress: data.trueZPress,
    disableLedgedashSocdOverride: data.disableLedgedashSocdOverride,
    customAirdodge: data.customAirdodge ? [data.customAirdodge.x, data.customAirdodge.y] : undefined,
  };
}

export function exportMeleeOptions(data: MeleeOptions): MeleeOptionsExport | undefined {
  if (!data.enabled) return undefined;

  return {
    crouchWalkOs: data.crouchWalkOs,
    disableLedgedashSocdOverride: data.disableLedgedashSocdOverride,
    customAirdodge: data.customAirdodge ? [data.customAirdodge.x, data.customAirdodge.y] : undefined,
  };
}

export type LayoutExport = {
  name: string;
  viewport: [number, number];

  deviceName?: string;
  pattern?: string;

  buttons: [PhysicalButtonExport, number, number][];
  modes: Partial<{ [key in GameMode]: ModeConfigExport }>;

  projectMOptions?: ProjectMOptionsExport;
  meleeOptions?: MeleeOptionsExport;
};

export type LayoutIndex = { name: string; path: string };

function parseBinding([button, binding, visibility]: NonNullable<
  ModeConfigResponse['bindings']
>[number]): ModeConfig['bindings'][number] {
  const physical = button.toString() as PhysicalButton;

  if (visibility === 'hidden') {
    return [physical, binding, visibility];
  }

  return [physical, binding];
}

function parseModeConfigResponse(data: ModeConfigExport | ModeConfigResponse): ModeConfig {
  return {
    bindings:
      data.bindings?.map(([b, x, v]) => {
        const physical = b.toString() as PhysicalButton;
        return v ? [physical, x, v] : [physical, x];
      }) ?? [],
    socd: data.socd ?? [],
  };
}

function parseLayoutResponseButtons(data?: LayoutResponse['buttons']): Layout['buttons'] {
  if (!data) return [];
  return data?.map(([b, x, y]) => [b.toString() as PhysicalButton, x, y]);
}

function parseLayoutResponseModes(data?: LayoutResponse['modes']): Layout['modes'] {
  if (!data) return {};
  return Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [k as GameMode, parseModeConfigResponse(v)]));
}

function parseLayoutResponseProjectMOptions(data?: LayoutResponse['projectMOptions']): ProjectMOptions {
  if (!data) return DEFAULT_PROJECT_M_OPTIONS;

  const { trueZPress, disableLedgedashSocdOverride } = data;
  const customAirdodge = data.customAirdodge ? { x: data.customAirdodge[0], y: data.customAirdodge[1] } : null;

  return {
    enabled: true,
    trueZPress,
    disableLedgedashSocdOverride,
    customAirdodge,
  };
}

function parseLayoutResponseMeleeOptions(data?: LayoutResponse['meleeOptions']): MeleeOptions {
  if (!data) return DEFAULT_MELEE_OPTIONS;

  const { crouchWalkOs, disableLedgedashSocdOverride } = data;
  const customAirdodge = data.customAirdodge ? { x: data.customAirdodge[0], y: data.customAirdodge[1] } : null;

  return {
    enabled: true,
    crouchWalkOs,
    disableLedgedashSocdOverride,
    customAirdodge,
  };
}

async function loadLayout(entry: LayoutIndex): Promise<Layout> {
  const res = await fetch(`/layouts/${entry.path}`);
  const data: LayoutResponse = await res.json();

  // /a/b/c.json -> a_b_c
  const id = entry.path.replace(/\//g, '_').replace('.json', '');

  return {
    id,
    name: data.name,

    deviceName: data.deviceName,
    pattern: data.pattern ? (parseRegex(data.pattern) ?? undefined) : undefined,

    viewport: data.viewport,

    buttons: parseLayoutResponseButtons(data.buttons),
    modes: parseLayoutResponseModes(data.modes),

    projectMOptions: parseLayoutResponseProjectMOptions(data.projectMOptions),
    meleeOptions: parseLayoutResponseMeleeOptions(data.meleeOptions),
  };
}

const LAYOUT_INDEX_CACHE_KEY = 'layoutIndex';
const LAYOUTS_CACHE_KEY = 'layouts';

function cacheLayoutIndex(index: LayoutIndex[]) {
  localStorage.setItem(LAYOUT_INDEX_CACHE_KEY, JSON.stringify(index));
}

function cacheLayouts(layouts: Map<string, Layout>) {
  localStorage.setItem(LAYOUTS_CACHE_KEY, MAP_SERIALIZER.write(layouts));
}

function getCachedLayoutIndex(): LayoutIndex[] | null {
  const index = localStorage.getItem(LAYOUT_INDEX_CACHE_KEY);
  if (!index) return null;
  return JSON.parse(index);
}

function getCachedLayouts(): Map<string, Layout> | null {
  const layouts = localStorage.getItem(LAYOUTS_CACHE_KEY);
  if (!layouts) return null;
  return MAP_SERIALIZER.read(layouts);
}

async function loadLayouts(): Promise<Layout[]> {
  let index: LayoutIndex[] | null;
  try {
    const res = await fetch('/layouts/index.json');
    index = (await res.json()) as LayoutIndex[];
    cacheLayoutIndex(index);
  } catch (e) {
    console.warn('Failed to load layout index:', e);
    index = getCachedLayoutIndex();
  }

  if (index == null) {
    console.warn('Failed to load cached layout index');
    index = [];
  }

  const layouts: Map<string, Layout> = getCachedLayouts() ?? new Map();
  const cachedLayoutsNotFound = layouts.size === 0;

  for (const entry of index) {
    try {
      layouts.set(entry.path, await loadLayout(entry));
    } catch (e) {
      console.warn(`Failed to load layout: ${entry.path}`, e);
    }
  }

  if (cachedLayoutsNotFound && layouts.size === 0) {
    const { toast } = useToast();

    toast({
      variant: 'destructive',
      title: 'Failed to load layouts',
      description: 'No cached layouts found.',
    });
  }

  cacheLayouts(layouts);

  return Array.from(layouts.values());
}

const layouts: Map<string, Layout> = new Map();

export async function getLayouts() {
  if (layouts.size === 0) {
    for (const layout of await loadLayouts()) {
      layouts.set(layout.id, layout);
    }
  }

  return layouts;
}

export function validateLayout(data: LayoutExport): [string, string][] | null {
  const errors: Map<keyof LayoutExport, string> = new Map();

  data.name = data.name?.trim();

  if (!data.name) {
    errors.set('name', 'required');
  } else if (typeof data.name !== 'string') {
    errors.set('name', 'must be a string');
  }

  if (data.deviceName && typeof data.deviceName !== 'string') {
    errors.set('deviceName', 'must be a string');
  }

  if (data.pattern && typeof data.pattern !== 'string') {
    errors.set('pattern', 'must be a string');
  }

  if (!Array.isArray(data.buttons)) {
    errors.set('buttons', 'must be an array');
  }

  if (typeof data.modes !== 'object') {
    errors.set('modes', 'must be an object');
  }

  // todo: more validation if its an issue

  if (errors.size > 0) {
    return Array.from(errors.entries());
  }

  return null;
}

export function layoutIdFromName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      // todo: maybe allow more characters
      .replace(/[^0-9a-z]+/g, '_')
  );
}

export function layoutFromExport(data: LayoutExport): Layout {
  return {
    id: layoutIdFromName(data.name),
    name: data.name,
    deviceName: data.deviceName,
    viewport: data.viewport,
    pattern: data.pattern ? (parseRegex(data.pattern) ?? undefined) : undefined,
    buttons: data.buttons.map(([b, x, y]) => [b.toString() as PhysicalButton, x, y]),
    modes: Object.fromEntries(Object.entries(data.modes ?? {}).map(([k, v]) => [k, parseModeConfigResponse(v)])),
    projectMOptions: parseLayoutResponseProjectMOptions(data.projectMOptions),
    meleeOptions: parseLayoutResponseMeleeOptions(data.meleeOptions),
  };
}

export async function importLayout(file: File) {
  console.debug('Importing layout:', file);

  const { toast } = useToast();

  try {
    const data = await readFile(file);
    const imported = JSON.parse(data) as LayoutExport;

    const errors = validateLayout(imported);

    if (errors != null) {
      console.error('Failed to import layout:');
      for (const [key, error] of errors) {
        console.error(key, error);
      }

      toast({
        variant: 'destructive',
        title: 'Failed to import layout',
        description: 'The file is not a valid layout.',
      });

      return;
    }

    const layout = layoutFromExport(imported);

    layouts.set(layout.id, layout);

    return layout;
  } catch (e) {
    if (e instanceof SyntaxError) {
      console.error('Failed to import layout:', e);
      toast({
        variant: 'destructive',
        title: 'Failed to import layout',
        description: 'The file is not valid JSON.',
      });
    } else {
      console.error('Failed to import layout:', e);
      toast({
        variant: 'destructive',
        title: 'Failed to import layout',
        description: 'An unknown error occurred. Check the console for more details.',
      });
    }
  }
}
