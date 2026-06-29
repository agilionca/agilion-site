import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blogSchema = z.object({
  title: z.string().min(10).max(100),
  description: z.string().min(50).max(200),
  pubDate: z.coerce.date(),
  updatedDate: z.coerce.date().optional(),
  author: z.string().default('Équipe Agilion'),
  tags: z.array(z.string()).min(1).max(8),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  draft: z.boolean().default(false),
  lang: z.enum(['fr', 'en']),
  translationSlug: z.string().optional(),
  category: z.enum(['cloud', 'logiciel', 'securite', 'web', 'consultation', 'ia']),
  readingTime: z.number().optional(),
});

export const collections = {
  'blog-fr': defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog-fr' }),
    schema: blogSchema,
  }),
  'blog-en': defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog-en' }),
    schema: blogSchema,
  }),
};
