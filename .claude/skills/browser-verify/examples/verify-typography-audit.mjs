// Typography audit: records { key, letterSpacing, fontFamily } via getComputedStyle
// for every visible text-bearing element (plus inputs/textareas/selects/buttons and
// SVG text/tspan) across a fixed list of UI states. Run once on master (before) and
// once on the branch (after); diff the two JSON files by key to prove the global
// letter-spacing sweep is a visual no-op except for the accepted/preserved cases.
//
// Usage: node verify-typography-audit.mjs <output.json> [--mobile-only]
//   Expects the API on 5065 and vite on 5066 (see the typography-sweep worktree).
//
// Seeds ZZTEST fixtures via the API, drives the UI, restores any goals it changes,
// and deletes every fixture it created in `finally`.
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const outPath = process.argv[2];
if (!outPath) {
  console.error('Usage: node verify-typography-audit.mjs <output.json>');
  process.exit(1);
}

const API_BASE = 'http://localhost:5065/api/';
const APP_BASE = 'http://localhost:5066';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Serialized into the page via page.evaluate — no closures over outer scope.
function captureAll(state) {
  function normalizeClass(cls) {
    // Dev CSS-module classes look like `_todayIcon_2evcq_59`: name, hash, line
    // number. The trailing number shifts whenever lines are added/removed, so
    // strip both the hash and the line number and keep only the name.
    const m = /^_([A-Za-z0-9]+)_[A-Za-z0-9]+_\d+$/.exec(cls);
    return m ? m[1] : cls;
  }
  function classKeyFor(el) {
    if (!el || !el.classList || el.classList.length === 0) return '';
    return [...el.classList].map(normalizeClass).sort().join('.');
  }
  function isVisible(el) {
    if (typeof el.checkVisibility === 'function') {
      try {
        return el.checkVisibility({ opacityProperty: false, visibilityProperty: false });
      } catch (_) {
        return el.checkVisibility();
      }
    }
    return el.offsetParent !== null;
  }
  function hasOwnText(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && node.textContent.trim().length > 0) return true;
    }
    return false;
  }

  const candidates = new Set();
  document.querySelectorAll('*').forEach((el) => {
    if (hasOwnText(el)) candidates.add(el);
  });
  document.querySelectorAll('input, textarea, select, button').forEach((el) => candidates.add(el));
  document.querySelectorAll('svg text, svg tspan').forEach((el) => candidates.add(el));

  const results = [];
  candidates.forEach((el) => {
    if (!isVisible(el)) return;
    const cs = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const ownClasses = classKeyFor(el);
    const ancestors = [];
    let p = el.parentElement;
    while (p && ancestors.length < 2) {
      const k = classKeyFor(p);
      if (k) ancestors.push(k);
      p = p.parentElement;
    }
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const key = `${state}|${tag}|${ownClasses}|${ancestors.join('>')}|${text}`;
    results.push({
      key,
      state,
      tag,
      ownClasses,
      ancestors: ancestors.join('>'),
      text,
      letterSpacing: cs.letterSpacing,
      fontFamily: cs.fontFamily,
    });
  });
  return results;
}

async function capture(page, state) {
  await sleep(300);
  const rows = await page.evaluate(captureAll, state);
  return rows;
}

async function openChatFab(page) {
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label^="Open "][aria-label$=" chat"]')].find((x) =>
      x.checkVisibility()
    );
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (opened) {
    await page.mouse.click(opened.x, opened.y);
    await sleep(1500);
    return true;
  }
  return false;
}

const CHAT_MD = [
  'Here is a summary:',
  '',
  '| Day | Calories | Protein |',
  '| --- | ---: | ---: |',
  '| Monday | 2,140 | 162 g |',
  '| Tuesday | 1,980 | 150 g |',
  '',
  'Use `npm run typecheck` inline, and:',
  '',
  '```js',
  'function total(a, b) {',
  '  return a + b;',
  '}',
  '```',
].join('\n');

async function main() {
  const all = [];
  let sectionId, movementId, variationIds = [], bodyWeightIds = [], habitId, entryId, savedGoals;

  // ---- Mobile, authenticated pass ----
  const { page, api, appBase, browser } = await launchAuthed({
    apiBase: API_BASE,
    appBase: APP_BASE,
    contextOptions: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  });

  try {
    // ---- Seed fixtures ----
    const secRes = await api.post('sections', { data: { label: 'ZZTEST Section' } });
    sectionId = (await secRes.json()).data?.sectionId;
    const movRes = await api.post(`movements/${sectionId}`, { data: { label: 'ZZTEST Movement' } });
    movementId = (await movRes.json()).data?.movementId;
    for (const label of ['ZZTEST Variation A', 'ZZTEST Variation B']) {
      const vRes = await api.post(`variations/${movementId}`, { data: { label, weight: 100, reps: 8 } });
      const vId = (await vRes.json()).data?.variationId;
      variationIds.push(vId);
    }
    // A few history points on the first variation so the graph renders with ticks.
    const histBase = new Date();
    for (let i = 4; i >= 0; i--) {
      const d = new Date(histBase.getTime() - i * 3 * 24 * 60 * 60 * 1000);
      await api.patch(`variations/${variationIds[0]}`, {
        data: { weight: 100 + i * 7, reps: 5 + i, date: d.toISOString() },
      });
    }

    for (let i = 3; i >= 0; i--) {
      const d = new Date(Date.now() - i * 4 * 24 * 60 * 60 * 1000);
      const bRes = await api.post('body-weight', { data: { weight: 180 - i * 1.5, date: d.toISOString() } });
      const bId = (await bRes.json()).data?.id;
      if (bId) bodyWeightIds.push(bId);
    }

    const hRes = await api.post('habits', { data: { name: 'ZZTEST Habit' } });
    habitId = (await hRes.json()).data?.id;

    const gGet = await api.get('nutrition/goals');
    savedGoals = (await gGet.json()).data ?? null;
    await api.put('nutrition/goals', { data: { calories: 2000, protein_g: 150, carbs_g: null, fat_g: null, fiber_g: null } });

    const today = localDate();
    const eRes = await api.post('nutrition/entries', {
      data: {
        localDate: today,
        meal: 'lunch',
        name: 'ZZTEST Nutrition Entry',
        source: 'manual',
        ingredients: [{ name: 'ZZTEST rice', grams: 100, source: 'manual', calories: 130, protein_g: 3, carbs_g: 28, fat_g: 0 }],
      },
    });
    const eJson = await eRes.json();
    entryId = eJson.data?.id ?? eJson.data?.entry?.id ?? eJson.id;

    // ---- State 1: Workouts tab ----
    await page.goto(`${appBase}/?tab=workouts`);
    await waitFor(page, () => document.body.textContent.includes('ZZTEST Variation A'), { timeout: 25000 });
    all.push(...(await capture(page, 'workouts-tab')));

    // Notes modal
    const notesBtn = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button[aria-label="Notes"]')].filter((b) => b.checkVisibility());
      const b = btns[0];
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (notesBtn) {
      await page.mouse.click(notesBtn.x, notesBtn.y);
      await waitFor(page, () => !!document.querySelector('button[aria-label="Close"]'), { timeout: 8000 }).catch(() => {});
      await sleep(400);
      all.push(...(await capture(page, 'workouts-notes-modal')));
      await page.keyboard.press('Escape');
      await sleep(400);
    }

    // Weight graph modal
    const graphBtn = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button[class*="graphBtn"]')].filter((b) => b.checkVisibility());
      const b = btns[0];
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (graphBtn) {
      await page.mouse.click(graphBtn.x, graphBtn.y);
      await waitFor(page, () => !!document.querySelector('div[class*="chartWrap"] svg'), { timeout: 8000 }).catch(() => {});
      await sleep(600);
      all.push(...(await capture(page, 'workouts-graph-modal')));
      await page.screenshot({ path: '/tmp/typo-chart-variation.png' }).catch(() => {});
      await page.keyboard.press('Escape');
      await sleep(400);
    }

    // ---- State 2: Body Weight tab ----
    await page.goto(`${appBase}/?tab=body-weight`);
    await waitFor(page, () => document.querySelectorAll('div[class*="chartWrap"] svg').length > 0 || document.body.textContent.includes('lbs'), {
      timeout: 20000,
    }).catch(() => {});
    await sleep(600);
    all.push(...(await capture(page, 'body-weight-tab')));
    await page.screenshot({ path: '/tmp/typo-chart-bodyweight.png' }).catch(() => {});

    // ---- State 3: Habits tab ----
    await page.goto(`${appBase}/?tab=habits`);
    await waitFor(page, () => document.body.textContent.includes('ZZTEST Habit'), { timeout: 20000 }).catch(() => {});
    all.push(...(await capture(page, 'habits-tab')));

    // ---- State 4: Nutrition tab ----
    await page.goto(`${appBase}/?tab=nutrition`);
    await waitFor(page, () => document.body.textContent.includes('ZZTEST Nutrition Entry'), { timeout: 20000 }).catch(() => {});
    all.push(...(await capture(page, 'nutrition-tab')));

    // Add food editor
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Add food') && x.checkVisibility());
      b?.click();
    });
    await waitFor(page, () => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Add Food Entry'), { timeout: 10000 }).catch(() => {});
    await sleep(500);
    all.push(...(await capture(page, 'nutrition-add-food-editor')));

    // Ingredient sheet, opened from the editor
    const addIngBtn = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('h2')].find((h) => h.textContent === 'Add Food Entry')?.closest('[role=dialog]');
      const b = dlg?.querySelector('button[aria-label="Add ingredient"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (addIngBtn) {
      await page.mouse.click(addIngBtn.x, addIngBtn.y);
      await waitFor(page, () => !!document.querySelector('input[aria-label="Ingredient name"]'), { timeout: 8000 }).catch(() => {});
      await sleep(500);
      all.push(...(await capture(page, 'nutrition-ingredient-sheet')));
      await page.keyboard.press('Escape');
      await sleep(400);
    }
    // Close editor
    await page.keyboard.press('Escape');
    await sleep(500);

    // Goals modal
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button[aria-label="More options"]')].find((x) => x.checkVisibility());
      b?.click();
    });
    await sleep(400);
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('[role=menuitem], button')].find((x) => x.textContent.trim() === 'Goals' && x.checkVisibility());
      item?.click();
    });
    await waitFor(page, () => document.body.textContent.includes('Nutrition Goals'), { timeout: 8000 }).catch(() => {});
    await sleep(400);
    all.push(...(await capture(page, 'nutrition-goals-modal')));
    await page.keyboard.press('Escape');
    await sleep(400);

    // My Foods sheet
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button[aria-label="More options"]')].find((x) => x.checkVisibility());
      b?.click();
    });
    await sleep(400);
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('[role=menuitem], button')].find((x) => x.textContent.trim() === 'My Foods' && x.checkVisibility());
      item?.click();
    });
    await waitFor(page, () => !!document.querySelector('[role=dialog][aria-label="My Foods"]'), { timeout: 8000 }).catch(() => {});
    await sleep(400);
    all.push(...(await capture(page, 'nutrition-my-foods-sheet')));
    await page.keyboard.press('Escape');
    await sleep(400);

    // ---- State 5: AI chat, expanded, with injected messages ----
    await page.route('**/api/chat/active', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      const now = new Date().toISOString();
      body.data.messages = [
        ...(body.data.messages ?? []),
        { id: 'zztest-typo-u1', role: 'user', parts: [{ type: 'text', text: 'ZZTEST typography check' }], interrupted: false, created_at: now },
        {
          id: 'zztest-typo-a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-search_foods',
              toolCallId: 'zztest-tool-1',
              state: 'output-available',
              input: { query: 'ZZTEST rice' },
              output: [{ name: 'ZZTEST Rice, white', source: 'usda', calories: 130 }],
            },
            { type: 'text', text: CHAT_MD },
          ],
          interrupted: false,
          created_at: now,
        },
      ];
      await route.fulfill({ response: res, json: body });
    });
    await page.goto(`${appBase}/?tab=nutrition`);
    await waitFor(page, () => !!document.querySelector('button[aria-label^="Open "][aria-label$=" chat"]'), { timeout: 20000 }).catch(() => {});
    const chatOpened = await openChatFab(page);
    if (chatOpened) {
      await waitFor(page, () => document.body.textContent.includes('ZZTEST typography check'), { timeout: 15000 }).catch(() => {});
      await sleep(600);
      all.push(...(await capture(page, 'chat-expanded')));
      await page.screenshot({ path: '/tmp/typo-chat-expanded.png' }).catch(() => {});

      // Expand the injected ToolCallCard to reach its Results/badge/section-label rules.
      const expanded = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button[aria-expanded]')].find((b) => b.checkVisibility());
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (expanded) {
        await sleep(500);
        all.push(...(await capture(page, 'chat-tool-card-expanded')));
      }
    }

    // Chat history panel
    await page.goto(`${appBase}/?tab=chat-history`);
    await sleep(1200);
    all.push(...(await capture(page, 'chat-history-panel')));

    // ---- State 6 (mobile): Header, nav drawer, account menu, changelog, feedback ----
    await page.goto(`${appBase}/?tab=workouts`);
    await waitFor(page, () => document.body.textContent.includes('ZZTEST Variation A'), { timeout: 20000 });
    all.push(...(await capture(page, 'header-mobile')));

    await page.evaluate(() => document.querySelector('button[aria-label="Open navigation menu"]')?.click());
    await sleep(500);
    all.push(...(await capture(page, 'nav-drawer')));
    await page.keyboard.press('Escape');
    await sleep(400);

    await page.evaluate(() => document.querySelector('button[aria-label="Account menu"]')?.click());
    await sleep(400);
    all.push(...(await capture(page, 'account-menu')));
    await page.mouse.click(5, 5);
    await sleep(300);

    await page.evaluate(() => document.querySelector('button[aria-label^="What\'s new"]')?.click());
    await waitFor(page, () => document.body.textContent.includes("What's new") || document.querySelectorAll('[role=dialog]').length > 0, { timeout: 8000 }).catch(() => {});
    await sleep(400);
    all.push(...(await capture(page, 'changelog-modal')));
    await page.keyboard.press('Escape');
    await sleep(400);

    await page.evaluate(() => document.querySelector('button[aria-label="Send feedback"]')?.click());
    await sleep(500);
    all.push(...(await capture(page, 'feedback-modal')));
    await page.keyboard.press('Escape');
    await sleep(400);
  } finally {
    if (entryId) await api.delete(`nutrition/entries/${entryId}`).catch(() => {});
    if (savedGoals !== undefined) {
      await api
        .put('nutrition/goals', { data: savedGoals ?? { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null } })
        .catch(() => {});
    }
    if (habitId) await api.delete(`habits/${habitId}`).catch(() => {});
    for (const id of bodyWeightIds) await api.delete(`body-weight/${id}`).catch(() => {});
    if (sectionId) await api.delete(`sections/${sectionId}`).catch(() => {}); // cascades movements/variations/history
    await teardown({ browser, api });
  }

  // ---- Desktop pass: header at 1280x800 ----
  {
    const { page: dpage, api: dapi, appBase: dAppBase, browser: dbrowser } = await launchAuthed({
      apiBase: API_BASE,
      appBase: APP_BASE,
      contextOptions: { viewport: { width: 1280, height: 800 } },
    });
    try {
      await dpage.goto(`${dAppBase}/?tab=workouts`);
      await waitFor(dpage, () => !!document.querySelector('header'), { timeout: 20000 });
      await sleep(500);
      all.push(...(await capture(dpage, 'header-desktop')));
    } finally {
      await teardown({ browser: dbrowser, api: dapi });
    }
  }

  // ---- Signed-out pass: sign-in / sign-up, fresh context, no auth ----
  {
    const { chromium } = await import('playwright');
    const browser2 = await chromium.launch();
    const context2 = await browser2.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page2 = await context2.newPage();
    try {
      await page2.goto(`${APP_BASE}/sign-in`);
      await waitFor(page2, () => !!document.querySelector('form'), { timeout: 20000 });
      await sleep(400);
      all.push(...(await capture(page2, 'sign-in-page')));

      await page2.goto(`${APP_BASE}/sign-up`);
      await waitFor(page2, () => !!document.querySelector('form'), { timeout: 20000 });
      await sleep(400);
      all.push(...(await capture(page2, 'sign-up-page')));
    } finally {
      await browser2.close();
    }
  }

  const fs = await import('fs');
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2));
  console.log('RESULT', JSON.stringify({ captured: all.length, states: [...new Set(all.map((r) => r.state))] }));
}

await main();
