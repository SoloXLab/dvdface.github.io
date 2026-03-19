<script setup lang="ts">
import { useData } from '@theme/useData'
import { computed } from 'vue'
import { withBase } from 'vuepress/client'

const { frontmatter } = useData<DefaultThemeHomePageFrontmatter>()

const features = computed(() => frontmatter.value.features ?? [])
</script>

<template>
  <div v-if="features.length" class="vp-features">
    <div v-for="feature in features" :key="feature.title" class="vp-feature">
      <a
        v-if="feature.link"
        :href="withBase(feature.link)"
        class="vp-feature-link"
      >
        <h2>{{ feature.title }}</h2>
        <p>{{ feature.details }}</p>
      </a>
      <div v-else>
        <h2>{{ feature.title }}</h2>
        <p>{{ feature.details }}</p>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.vp-features {
  display: flex;
  flex-wrap: wrap;
  place-content: stretch space-between;
  align-items: flex-start;

  margin-top: 2.5rem;
  padding: 1.2rem 0;
  border-top: 1px solid var(--vp-c-divider);

  transition: border-color var(--vp-t-color);

  @media (max-width: 719px) {
    flex-flow: column;
  }
}

.vp-feature {
  flex-grow: 1;
  flex-basis: 30%;
  max-width: 30%;

  @media (max-width: 719px) {
    max-width: 100%;
    padding: 0 2.5rem;
  }

  > * {
    display: block;
    height: 100%;
  }

  .vp-feature-link {
    text-decoration: none;
    color: inherit;
    cursor: pointer;
    transition: color var(--vp-t-color);

    &:hover {
      color: var(--vp-c-accent);
    }
  }

  h2 {
    padding-bottom: 0;
    border-bottom: none;
    font-weight: 500;
    font-size: 1.4rem;

    @media (max-width: 419px) {
      font-size: 1.25rem;
    }
  }

  p {
    color: var(--vp-c-text-mute);
  }
}
</style>
