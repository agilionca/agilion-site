import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface Topic {
  id: string;
  titleFR: string;
  titleEN: string;
  category: string;
  keywords: string[];
  targetAudience: string;
}

async function generateArticle(topic: Topic, lang: 'fr' | 'en'): Promise<string> {
  const templatePath = resolve('scripts/prompts/tech-article.txt');
  const template = readFileSync(templatePath, 'utf-8');

  const title = lang === 'fr' ? topic.titleFR : topic.titleEN;
  const prompt = template
    .replace('{{TITLE}}', title)
    .replace('{{LANG}}', lang === 'fr' ? 'Français (québécois)' : 'English (North American)')
    .replace('{{CATEGORY}}', topic.category)
    .replace('{{KEYWORDS}}', topic.keywords.join(', '));

  // Utilise le cache Anthropic pour réduire les coûts (contexte système réutilisé)
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: [
      {
        type: 'text',
        text: 'Tu es un expert en rédaction de contenu B2B pour des firmes TI. Tu génères du contenu MDX précis, factuel et optimisé SEO.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');
  return content.text;
}

function getNextTopic(topics: Topic[]): Topic {
  const indexFile = resolve('scripts/prompts/.last-topic-index');
  let lastIndex = -1;
  if (existsSync(indexFile)) {
    lastIndex = parseInt(readFileSync(indexFile, 'utf-8').trim(), 10);
  }
  const nextIndex = (lastIndex + 1) % topics.length;
  writeFileSync(indexFile, String(nextIndex));
  return topics[nextIndex];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function addFrontmatterDefaults(
  mdx: string,
  lang: 'fr' | 'en',
  _topic: Topic,
  _slug: string,
  translationSlug: string
): string {
  const today = new Date().toISOString().split('T')[0];

  if (!mdx.includes('lang:')) {
    mdx = mdx.replace('---\n', `---\nlang: "${lang}"\n`);
  }
  if (!mdx.includes('translationSlug:')) {
    mdx = mdx.replace('---\n', `---\ntranslationSlug: "${translationSlug}"\n`);
  }
  if (!mdx.includes('pubDate:')) {
    mdx = mdx.replace('---\n', `---\npubDate: ${today}\n`);
  }
  if (!mdx.includes('draft:')) {
    mdx = mdx.replace('---\n', `---\ndraft: false\n`);
  }
  return mdx;
}

async function main() {
  const topicsPath = resolve('scripts/prompts/topics.json');
  const { topics } = JSON.parse(readFileSync(topicsPath, 'utf-8')) as { topics: Topic[] };

  // Si un sujet est passé en argument, l'utiliser. Sinon, prendre le suivant dans la liste.
  const topicArg = process.env.TOPIC;
  const topic = topicArg
    ? (topics.find((t) => t.id === topicArg || t.titleFR.includes(topicArg)) ?? getNextTopic(topics))
    : getNextTopic(topics);

  console.log(`Generating article: "${topic.titleFR}" (${topic.id})`);

  const slugFR = slugify(topic.titleFR);
  const slugEN = slugify(topic.titleEN);

  // Générer FR et EN (le cache Anthropic réutilise le contexte système entre les deux appels)
  console.log('  -> Generating FR version...');
  const mdxFR = await generateArticle(topic, 'fr');
  const finalFR = addFrontmatterDefaults(mdxFR, 'fr', topic, slugFR, slugEN);

  console.log('  -> Generating EN version...');
  const mdxEN = await generateArticle(topic, 'en');
  const finalEN = addFrontmatterDefaults(mdxEN, 'en', topic, slugEN, slugFR);

  // Sauvegarder les fichiers MDX
  const outFR = resolve(`src/content/blog-fr/${slugFR}.mdx`);
  const outEN = resolve(`src/content/blog-en/${slugEN}.mdx`);

  writeFileSync(outFR, finalFR);
  writeFileSync(outEN, finalEN);

  console.log(`Articles generated:`);
  console.log(`   FR: src/content/blog-fr/${slugFR}.mdx`);
  console.log(`   EN: src/content/blog-en/${slugEN}.mdx`);

  console.log(`\nNote: Run 'npx tsx scripts/generate-article.ts' locally to preview before publish`);
}

main().catch(console.error);
