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
  // Choisir le template selon la catégorie
  const templateFile = topic.category === 'consultation' ? 'business-article.txt' : 'tech-article.txt';
  const template = readFileSync(resolve(`scripts/prompts/${templateFile}`), 'utf-8');

  // System prompt avec template complet (>1024 tokens pour activer le cache Anthropic)
  const systemPrompt = `Tu es un expert en rédaction de contenu B2B pour des firmes TI. Tu génères du contenu MDX précis, factuel et optimisé SEO.

CONTEXTE AGILION :
- Services : développement logiciel sur mesure, intégration APIs, cloud (AWS/Azure/GCP), cybersécurité, développement web, consultation TI
- Clients : PME québécoises et entreprises canadiennes/américaines
- Mission : transformer les défis TI en avantages compétitifs
- Ton : professionnel mais accessible, concret, basé sur des faits

INSTRUCTIONS DE GÉNÉRATION :
${template}`;

  const title = lang === 'fr' ? topic.titleFR : topic.titleEN;
  const langLabel = lang === 'fr' ? 'Français québécois professionnel' : 'North American English';

  const userMessage = `Génère un article MDX complet sur: "${title}"
Langue: ${langLabel}
Catégorie: ${topic.category}
Mots-clés: ${topic.keywords.join(', ')}
Audience cible: ${topic.targetAudience}`;

  // Utilise le cache Anthropic — system prompt >1024 tokens pour activer ephemeral cache
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
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
  // Normaliser les line endings (robustesse CRLF)
  mdx = mdx.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Valider que le frontmatter existe au début
  if (!mdx.startsWith('---\n')) {
    // Claude ajoute parfois du texte avant le frontmatter
    const fmStart = mdx.indexOf('---\n');
    if (fmStart === -1) {
      throw new Error(`Claude n'a pas généré de frontmatter valide pour ${lang}. Contenu reçu:\n${mdx.substring(0, 200)}`);
    }
    mdx = mdx.substring(fmStart);
  }

  const today = new Date().toISOString().split('T')[0];
  const insertAfterDashes = '---\n';

  const additions: string[] = [];
  if (!mdx.includes('lang:')) additions.push(`lang: "${lang}"`);
  if (!mdx.includes('translationSlug:')) additions.push(`translationSlug: "${translationSlug}"`);
  if (!mdx.includes('pubDate:')) additions.push(`pubDate: ${today}`);
  if (!mdx.includes('draft:')) additions.push(`draft: false`);

  if (additions.length > 0) {
    mdx = insertAfterDashes + additions.join('\n') + '\n' + mdx.substring(insertAfterDashes.length);
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
