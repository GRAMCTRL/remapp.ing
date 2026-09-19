<script setup lang="ts">
import ButtonContent from '@/components/ButtonContent.vue';
import {
  BigSelect,
  BigSelectContent,
  BigSelectItem,
  BigSelectTrigger,
  BigSelectValue,
} from '@/components/ui/big_select';
import useActiveProfile from '@/composables/activeProfile';
import { BINDING } from '@/lib/bindings';
import { gameModeToName } from '@/lib/modes';
import { physicalToBinding } from '@/lib/bindings';
import { useDeviceManager } from '@/stores/deviceManager';
import { computed, ref } from 'vue';

const deviceManager = useDeviceManager();
const activeProfile = useActiveProfile();

// use ref to force recompute when config is saved
const configVersion = ref(0);

// register callback to increment version on save
deviceManager.onConfigSaved(() => {
  configVersion.value++;
});

const modes = computed(() => {
  configVersion.value;

  return [...deviceManager.modes.values()].map((x) => {
    const modeConfig = deviceManager.config?.gameModes.find((c) => c.id === x.id);
    const isDefault = x.id === deviceManager.config?.defaultMode;
    return {
      id: x.id,
      name: `${gameModeToName(x.id)}${isDefault ? ' (Default)' : ''}`,
      activation: x.activationBinding.map((physical) => {
        const remapped = modeConfig?.buttonRemapping.find((r) => r.physical === physical);
        if (remapped) {
          return remapped.binding;
        }
        return deviceManager.layout ? physicalToBinding(deviceManager.layout, x.id, physical) : BINDING.UNSPECIFIED;
      }),
    };
  });
});
</script>

<template>
  <BigSelect v-model="activeProfile">
    <BigSelectTrigger class="w-[280px]">
      <BigSelectValue placeholder="Select a mode" />
    </BigSelectTrigger>
    <BigSelectContent>
      <BigSelectItem v-for="mode in modes" :key="mode.id" :value="mode.id">
        <h2>{{ mode.name }}</h2>
        <span class="activations">
          <template v-if="mode.activation?.length" v-for="(activation, i) in mode.activation" :key="i">
            <template v-if="i > 0">+</template>
            <ButtonContent :binding="activation" />
          </template>
        </span>
      </BigSelectItem>
    </BigSelectContent>
  </BigSelect>
</template>

<style>
button.bigselect-trigger {
  padding: 1rem 1.75rem;
}

.bigselect-trigger h2,
.bigselect-item h2 {
  font-size: 2rem;
  text-transform: uppercase;
  color: var(--text-primary);

  transition: font-weight 150ms;
}

.bigselect-item:hover h2,
.bigselect-trigger h2 {
  font-weight: 600;
}

.bigselect-item h2 {
  font-weight: 400;
}

.bigselect-trigger span,
.bigselect-item span {
  font-size: 0.8rem;
  color: var(--text-tertiary);

  transition: font-weight 150ms;
  line-height: 1;
}

.bigselect-trigger span,
.bigselect-item:hover span {
  font-weight: 500;
}

.bigselect-item span {
  font-weight: 400;
}

.activations {
  display: flex;
  gap: 2px;
  align-items: center;

  svg {
    width: 0.6rem;
    height: 0.6rem;
  }
}
</style>
