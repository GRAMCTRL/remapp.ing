<script setup lang="ts">
import LayoutContainer from '@/components/LayoutContainer.vue';
import ProfileSelect from '@/components/ProfileSelect.vue';
import { BombIcon, SaveIcon } from '@/components/icons';
import BindingsPanel from '@/components/mapping/BindingsPanel.vue';
import SocdPanel from '@/components/mapping/SocdPanel.vue';
import ProjectMOptionsPanel from '@/components/mapping/ProjectMOptionsPanel.vue';
import MeleeOptionsPanel from '@/components/mapping/MeleeOptionsPanel.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import useActiveProfile from '@/composables/activeProfile';
import { BINDING, type Binding } from '@/lib/bindings';
import { GAME_MODE } from '@/lib/modes';
import { useDeviceManager } from '@/stores/deviceManager';
import { useProfile } from '@/stores/profiles';
import { Microchip, Power, RotateCcw } from 'lucide-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  DEFAULT_MELEE_OPTIONS,
  DEFAULT_PROJECT_M_OPTIONS,
  type Config,
  type MeleeOptions,
  type ProjectMOptions,
} from '@/lib/config';

const deviceManager = useDeviceManager();

const activeProfile = useActiveProfile();
const profile = computed(() => deviceManager.layout && useProfile(activeProfile.value, deviceManager.layout));

const projectMOptions = reactive<ProjectMOptions>(DEFAULT_PROJECT_M_OPTIONS);
const meleeOptions = reactive<MeleeOptions>(DEFAULT_MELEE_OPTIONS);

function onConfigLoaded(config: Config) {
  Object.assign(projectMOptions, config.projectMOptions);
  Object.assign(meleeOptions, config.meleeOptions);
}

function onRequestOptions(): {
  projectMOptions: ProjectMOptions;
  meleeOptions: MeleeOptions;
} {
  return {
    projectMOptions,
    meleeOptions,
  };
}

onMounted(() => {
  deviceManager.onConfigLoaded(onConfigLoaded);
  deviceManager.onRequestOptions(onRequestOptions);

  if (deviceManager.config != null) {
    onConfigLoaded(deviceManager.config);
  }
});

function onClick(i: number | null | undefined) {
  if (!profile.value) return;

  if (i === profile.value.selected) {
    profile.value.selected = null;
  } else {
    profile.value.selected = i ?? null;
  }
}

function clearSelected() {
  if (profile.value) profile.value.selected = null;
}

function onBindingSelect(binding: Binding) {
  profile.value?.setSelectedBinding(binding);

  // todo: should the button be unselected
  clearSelected();
}

function onBindingDrop(binding: Binding) {
  profile.value?.setHoveredBinding(binding);
}

function setSocdBinding(i: number, side: 'a' | 'b') {
  profile.value?.setSocdBinding(i, side);

  // todo: should the button be unselected
  clearSelected();
}

function onClear(i: number) {
  profile.value?.setBinding(i, BINDING.UNSPECIFIED);
}

type Tab = 'bindings' | 'socd' | 'project_m_options' | 'melee_options';

const tab = ref<Tab>('bindings');

const isProjectM = ref(false);
const isMelee = ref(false);

watch(
  activeProfile,
  () => {
    switch (activeProfile.value) {
      case GAME_MODE.PROJECT_M: {
        isProjectM.value = true;
        isMelee.value = false;
        if (tab.value === 'melee_options') tab.value = 'project_m_options';
        break;
      }
      case GAME_MODE.MELEE: {
        isProjectM.value = false;
        isMelee.value = true;
        if (tab.value === 'project_m_options') tab.value = 'melee_options';
        break;
      }
      default: {
        isProjectM.value = false;
        isMelee.value = false;

        if (tab.value === 'project_m_options' || tab.value === 'melee_options') {
          console.info('set tab bindings');
          tab.value = 'bindings';
        }
      }
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="mapping">
    <template v-if="profile">
      <LayoutContainer
        :show-socd="tab === 'socd'"
        :buttons="profile.buttons"
        :selected="profile.selected"
        @update:selected="onClick"
        @hover="profile.setHovered"
        :viewport-size="profile.viewportSize"
        @clear="onClear"
      />
    </template>

    <Tabs class="inspector" v-model="tab">
      <TabsList>
        <TabsTrigger value="bindings">BINDINGS</TabsTrigger>
        <TabsTrigger value="socd">SOCD</TabsTrigger>
        <TabsTrigger v-if="isProjectM" value="project_m_options">PROJECT M OPTIONS</TabsTrigger>
        <TabsTrigger v-if="isMelee" value="melee_options">MELEE OPTIONS</TabsTrigger>
      </TabsList>

      <TabsContent value="bindings" class="panel scroller">
        <BindingsPanel @select="onBindingSelect" @drop="onBindingDrop" :button-selected="profile?.selected != null" />
      </TabsContent>

      <TabsContent value="socd" class="panel scroller">
        <SocdPanel
          v-if="profile"
          :socds="profile.socd"
          @select="setSocdBinding"
          @change="profile.setSocdBindingType"
          @add="profile.addSocd"
          @remove="profile.removeSocd"
        />
      </TabsContent>

      <TabsContent value="project_m_options" class="panel scroller">
        <ProjectMOptionsPanel v-if="isProjectM && profile" :options="projectMOptions" />
      </TabsContent>

      <TabsContent value="melee_options" class="panel scroller">
        <MeleeOptionsPanel v-if="isMelee && profile" :options="meleeOptions" />
      </TabsContent>
    </Tabs>

    <footer class="flex">
      <div class="flex items-center gap-8">
        <ProfileSelect />

        <div>
          <h2 class="text-xl">Connected to:</h2>
          <span>{{ deviceManager.info?.deviceName }}</span>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger as-child>
              <DropdownMenuTrigger>
                <button class="btn icon h-16 w-16" @click="">
                  <Power class="h-8 w-8" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem @click="deviceManager.reboot()" class="cursor-pointer">
                  <RotateCcw class="h-4 w-4" />
                  <span class="text-base">Reboot</span>
                </DropdownMenuItem>
                <DropdownMenuItem @click="deviceManager.rebootToBootloader()" class="cursor-pointer">
                  <Microchip class="h-4 w-4" />
                  <span class="text-base">Reboot to bootloader</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </TooltipTrigger>
            <TooltipContent side="top" class="max-w-64 text-center" :collision-padding="8">
              <p>Reboot</p>
            </TooltipContent>
          </Tooltip>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="btn icon h-16 w-16" @click="profile?.clearMappings()">
              <BombIcon class="h-8 w-8" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" class="max-w-64 text-center" :collision-padding="8">
            <p>Nuclear Bomb</p>
            <p class="text-tertiary">Clear device remappings from active profile</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="btn icon h-16 w-16" @click="deviceManager.saveConfig()">
              <SaveIcon class="h-8 w-8" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" :collision-padding="8">
            <p>Save and Upload</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </footer>
  </section>
</template>

<style>
.mapping {
  @apply grid h-screen w-full gap-4 overflow-hidden p-4;

  grid-template-columns: 4rem 1fr 320px;
  grid-template-rows: 8rem minmax(0, 1fr) 88px;

  grid-template-areas:
    'header  header inspector'
    'sidebar layout inspector'
    'footer  footer footer';

  > .layout {
    grid-area: layout;
  }

  > .inspector {
    grid-area: inspector;
  }

  > footer {
    grid-area: footer;

    @apply flex items-center justify-between;
  }
}

.mapping .inspector {
  @apply flex flex-col flex-nowrap;

  > .panel {
    @apply flex flex-col flex-nowrap;

    &[data-state='inactive'] {
      display: none;
    }

    > div {
      @apply relative flex flex-col rounded-lg bg-secondary p-4 text-secondary;

      overflow-x: hidden;
      overflow-y: auto;
      min-height: 0;
    }
  }
}
</style>
