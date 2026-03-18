import { defaultTheme } from '@vuepress/theme-default'
import { defineUserConfig } from 'vuepress'
import { viteBundler } from '@vuepress/bundler-vite'

export default defineUserConfig({
  bundler: viteBundler(),
  lang: 'zh-CN',
  title: '首页',
  description: '静态网站 · 由 dvdface.github.io 托管',
  base: '/',
  theme: defaultTheme({
    navbar: [
      { text: '首页', link: '/' },
      { text: '提示词', link: '/prompts/' },
      { text: '育儿', link: '/parenting/' },
      { text: 'Android', link: '/android/' },
    ],
    sidebar: {
      '/prompts/': [
        {
          text: '提示词',
          children: ['/prompts/README.md', '/posts/prompt-writing-sop.md'],
        },
      ],
      '/parenting/': [
        {
          text: '育儿专栏',
          children: ['/parenting/README.md', '/posts/learning_by_research.md'],
        },
      ],
      '/android/': [
        {
          text: 'Android 专栏',
          children: ['/android/README.md', '/posts/android-io-optimization-insights.md'],
        },
      ],
      '/posts/': [
        {
          text: '文章',
          children: [
            '/posts/prompt-writing-sop.md',
            '/posts/learning_by_research.md',
            '/posts/android-io-optimization-insights.md',
          ],
        },
      ],
    },
    editLink: false,
    lastUpdated: false,
    contributors: false,
  }),
})
