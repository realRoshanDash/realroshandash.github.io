/**
 * Open Graph images, prerendered at build time: /og/default.png, /og/about.png, /og/blog/<post-id>.png … (the list
 * and the page each card belongs to are in src/lib/og.ts; the drawing is in src/lib/og-render.ts).
 */
import type { APIRoute, GetStaticPaths, InferGetStaticPropsType } from 'astro';
import { ogImages } from '@/lib/og';
import { renderOgPng } from '@/lib/og-render';

export const prerender = true;

export const getStaticPaths = (async () =>
  (await ogImages()).map(({ slug, card }) => ({ params: { slug }, props: { card } }))) satisfies GetStaticPaths;

type Props = InferGetStaticPropsType<typeof getStaticPaths>;

export const GET: APIRoute<Props> = async ({ props }) =>
  new Response(new Uint8Array(await renderOgPng(props.card)), { headers: { 'Content-Type': 'image/png' } });
