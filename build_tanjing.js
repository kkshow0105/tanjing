#!/usr/bin/env node
// Parse 坛经.txt and generate interactive HTML file.
// Strategy: pair original paragraphs 1:1 with translation paragraphs (file-level alignment),
// then split each original paragraph into clickable sentences.

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '坛经.txt');
const OUTPUT_FILE = path.join(__dirname, '坛经.html');

const CHAPTER_NAMES = [
    "行由品第一", "般若品第二", "疑问品第三", "定慧品第四",
    "坐禅品第五", "忏悔品第六", "机缘品第七", "顿渐品第八",
    "护法品第九", "付嘱品第十",
];

function cleanText(text) {
    return text.replace(/\[\d+\]/g, '');
}

function splitSentences(text) {
    if (!text.trim()) return [];
    const parts = text.split(/(?<=[。！？；])/);
    return parts.map(p => p.trim()).filter(p => p.length > 0);
}

function isMarkerLine(line) {
    return line.startsWith('【') || CHAPTER_NAMES.includes(line);
}

function extractOriginalLines(lines, startIdx, endIdx, startsAfterTranslation) {
    const origLines = [];
    let foundOrig = false;
    let seenTextBeforeOrig = false;
    let blankStreak = 0;

    for (let i = startIdx + 1; i < endIdx; i++) {
        const line = lines[i].trim();
        if (!line) {
            blankStreak++;
            if (startsAfterTranslation && seenTextBeforeOrig && blankStreak >= 2) {
                foundOrig = true;
            }
            continue;
        }
        if (isMarkerLine(line)) continue;

        if (startsAfterTranslation && !foundOrig) {
            if (/\[\d+\]/.test(line)) {
                foundOrig = true;
            } else {
                seenTextBeforeOrig = true;
                blankStreak = 0;
                continue;
            }
        } else if (!startsAfterTranslation && !foundOrig) {
            if (!/\[\d+\]/.test(line)) continue; // skip 题解/译文 content
            foundOrig = true;
        }

        origLines.push(line);
        blankStreak = 0;
    }

    return origLines;
}

function extractTranslationLines(lines, startIdx, endIdx) {
    const transLines = [];
    let blankStreak = 0;

    for (let i = startIdx + 1; i < endIdx; i++) {
        const line = lines[i].trim();
        if (!line) {
            blankStreak++;
            continue;
        }
        if (isMarkerLine(line)) continue;

        // Annotation markers are the strongest signal that the next original
        // block has started. At chapter/file tails, multi-blank gaps also
        // keep trailing table-of-contents text out of the translation.
        if (transLines.length > 0 && /\[\d+\]/.test(line)) break;
        if (transLines.length > 0 && blankStreak >= 2 && line === 'Table of Contents') break;

        transLines.push(line);
        blankStreak = 0;
    }

    return transLines;
}

function parseFile(filepath) {
    const content = fs.readFileSync(filepath, 'utf-8');
    const lines = content.split(/\r?\n/);

    // Build marker array
    const markers = [];
    for (let i = 0; i < lines.length; i++) {
        const stripped = lines[i].trim();
        const info = { idx: i, stripped };
        if (CHAPTER_NAMES.includes(stripped)) {
            info.isChapter = true;
        } else if (stripped === '【题解】') {
            info.isTijie = true;
        } else if (stripped === '【注释】') {
            info.isComment = true;
        } else if (stripped === '【译文】') {
            info.isYiwen = true;
        }
        if (info.isChapter || info.isTijie || info.isComment || info.isYiwen) {
            markers.push(info);
        }
    }

    const chapterMarkers = markers.filter(m => m.isChapter && m.idx > 100);
    const chapters = [];

    for (let ci = 0; ci < chapterMarkers.length; ci++) {
        const chStart = chapterMarkers[ci].idx;
        const chEnd = (ci + 1 < chapterMarkers.length) ? chapterMarkers[ci + 1].idx : lines.length;
        const title = chapterMarkers[ci].stripped;

        const chMarkers = markers.filter(m => m.idx >= chStart && m.idx < chEnd);
        const tijieIdx = (chMarkers.find(m => m.isTijie) || {}).idx || -1;
        const commentMarkers = chMarkers.filter(m => m.isComment).sort((a, b) => a.idx - b.idx);
        const yiwenMarkers = chMarkers.filter(m => m.isYiwen).sort((a, b) => a.idx - b.idx);

        // Pair each 【译文】 with the preceding 【注释】
        // Each pair: { origParas: string[], transParas: string[] }
        const blockPairs = [];
        let previousTransLines = [];

        for (const yw of yiwenMarkers) {
            // Find the 【注释】 that immediately precedes this 【译文】
            let commentMarker = null;
            for (const cm of commentMarkers) {
                if (cm.idx < yw.idx) commentMarker = cm;
                else break;
            }
            if (!commentMarker) continue;

            // Find start of original text: previous 【译文】 or 【题解】
            let origRangeStart = tijieIdx > 0 ? tijieIdx : chStart;
            for (const prevYw of yiwenMarkers) {
                if (prevYw.idx < commentMarker.idx) origRangeStart = prevYw.idx;
            }

            // Find end of translation text: next 【注释】 or chapter end
            let transRangeEnd = chEnd;
            for (const nextCm of commentMarkers) {
                if (nextCm.idx > yw.idx) { transRangeEnd = nextCm.idx; break; }
            }

            // --- Extract original paragraphs ---
            // After a 【译文】 block, the next original block is separated by
            // multiple blank lines; some original paragraphs have no [N] note.
            const startsAfterTranslation = yiwenMarkers.some(prevYw => prevYw.idx === origRangeStart);
            let origLines = extractOriginalLines(lines, origRangeStart, commentMarker.idx, startsAfterTranslation);
            if (startsAfterTranslation && previousTransLines.length > 0) {
                const previousTransSet = new Set(previousTransLines);
                origLines = origLines.filter(line => !previousTransSet.has(line));
            }

            // Split original lines into paragraphs (file-level blank-line separation)
            const origParas = [];
            let currentPara = [];
            for (const line of origLines) {
                // Treat each non-empty line as a paragraph
                origParas.push(line);
            }

            // --- Extract translation paragraphs ---
            // Stop before the next original block. Some original paragraphs do
            // not have [N] markers, so also honor the multi-blank block break.
            let transLines = extractTranslationLines(lines, yw.idx, transRangeEnd);
            if (origLines.length > 0 && transLines.length > 0) {
                const origLineSet = new Set(origLines.filter(line => cleanText(line).length > 40));
                transLines = transLines.filter(line => !origLineSet.has(line));
            }

            const transParas = [];
            for (const line of transLines) {
                transParas.push(line);
            }

            // Also clean original: remove suffix annotation markers from origText but keep text
            const cleanOrigParas = origParas.map(p => cleanText(p)).filter(p => p.trim());

            if (origParas.length > 0 && transParas.length > 0) {
                blockPairs.push({ origParas: cleanOrigParas, transParas });
            }
            previousTransLines = transLines;
        }

        if (blockPairs.length > 0) {
            chapters.push({ title, blockPairs });
        }
    }

    return chapters;
}

function buildAlignedData(chapters) {
    // Within each block, align original paragraphs with translation paragraphs positionally.
    // Since each original para maps 1:1 to a translation para at the file level,
    // use positional alignment. If counts differ, use proportional fallback.
    for (const ch of chapters) {
        ch.pairedParas = [];

        for (const bp of ch.blockPairs) {
            const { origParas, transParas } = bp;
            const nO = origParas.length;
            const nT = transParas.length;

            // If same count, simple 1:1 mapping
            if (nO === nT) {
                for (let i = 0; i < nO; i++) {
                    const sents = splitSentences(origParas[i]);
                    if (origParas[i].trim() && transParas[i].trim()) {
                        ch.pairedParas.push({
                            orig: origParas[i],
                            trans: transParas[i],
                            origSents: sents.length > 0 ? sents : [origParas[i]]
                        });
                    }
                }
            } else {
                // Fallback for unequal counts: keep the translation narrow.
                // Joining multiple translation paragraphs often leaks later text.
                for (let oi = 0; oi < nO; oi++) {
                    const normalizedOrig = normalizeForMatch(origParas[oi]);
                    const exactIndex = transParas.findIndex(t => {
                        const normalizedTrans = normalizeForMatch(t);
                        return normalizedTrans === normalizedOrig || normalizedTrans.startsWith(normalizedOrig);
                    });
                    const tIndex = exactIndex >= 0 ? exactIndex : Math.min(oi, nT - 1);
                    const mappedTrans = transParas[tIndex] || '';
                    const sents = splitSentences(origParas[oi]);
                    if (origParas[oi].trim() && mappedTrans.trim()) {
                        ch.pairedParas.push({
                            orig: origParas[oi],
                            trans: mappedTrans,
                            origSents: sents.length > 0 ? sents : [origParas[oi]]
                        });
                    }
                }
            }
        }
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizeForMatch(str) {
    return str.replace(/[，。！？；：“”‘’、,.;:!?""'']/g, '').replace(/\s+/g, '');
}

function generateHtml(chapters, outputPath) {
    // Build JSON for embedding: only include what we need
    const chaptersJson = JSON.stringify(chapters.map(ch => ({
        title: ch.title,
        pairedParas: ch.pairedParas
    })));

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>六祖坛经 - 原文·译文对照</title>
<style>
  :root {
    --bg: #f5f0e8;
    --card-bg: #fdfaf3;
    --text: #3d3226;
    --text-light: #6b5e4e;
    --accent: #8b4513;
    --accent-light: #cd853f;
    --highlight: #fff8e7;
    --highlight-border: #e6c450;
    --shadow: 0 2px 12px rgba(0,0,0,0.06);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", "KaiTi", serif;
    background: var(--bg);
    color: var(--text);
    line-height: 2;
    min-height: 100vh;
  }

  header {
    background: linear-gradient(135deg, #3d2b1f 0%, #5c3d2e 50%, #3d2b1f 100%);
    color: #f0e0c0; text-align: center; padding: 48px 24px 40px;
    position: relative;
    box-shadow: 0 2px 20px rgba(0,0,0,0.3);
  }
  header h1 { font-size: 1.8em; font-weight: 700; letter-spacing: 0.12em; margin-bottom: 6px; }
  header p { font-size: 0.95em; opacity: 0.7; letter-spacing: 0.1em; }

  nav {
    background: #fff; border-bottom: 1px solid #e0d5c0; padding: 4px 0;
    position: sticky; top: 0; z-index: 99; overflow-x: auto; white-space: nowrap;
    box-shadow: 0 1px 8px rgba(0,0,0,0.05); display: flex; justify-content: center;
  }
  nav a {
    display: inline-block; padding: 10px 14px; color: var(--text-light);
    text-decoration: none; font-size: 0.88em; border-bottom: 2px solid transparent;
    transition: all 0.2s; flex-shrink: 0;
  }
  nav a:hover, nav a.active { color: var(--accent); border-bottom-color: var(--accent); background: #fdf8f0; }

  main { max-width: 880px; margin: 0 auto; padding: 32px 20px 80px; }

  .chapter { margin-bottom: 48px; }
  .chapter-title {
    font-size: 1.6em; color: var(--accent); text-align: center;
    padding: 32px 0 16px; border-bottom: 2px solid #d5c5a0;
    margin-bottom: 32px; letter-spacing: 0.1em;
  }

  /* Each paired paragraph group */
  .para-group {
    background: var(--card-bg); border-radius: 8px;
    box-shadow: var(--shadow); margin-bottom: 20px; overflow: hidden;
    transition: box-shadow 0.3s;
  }
  .para-group.revealed { box-shadow: 0 2px 20px rgba(139,69,19,0.15); }

  /* Original text area */
  .orig-block { padding: 16px 20px 14px; }

  /* Each sentence in original */
  .orig-sent {
    display: inline;
    cursor: pointer;
    color: var(--text);
    font-size: 1.08em;
    font-weight: 600;
    transition: all 0.15s;
    position: relative;
  }
  .orig-sent:hover { color: var(--accent); }
  .orig-sent.active {
    color: var(--accent);
    background: linear-gradient(180deg, transparent 60%, rgba(205,133,63,0.2) 60%);
  }

  /* Translation area - hidden by default */
  .trans-block {
    padding: 0 20px;
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.5s ease, padding 0.5s ease;
    border-top: 0px solid #eee5d5;
    transition: all 0.4s ease;
  }
  .para-group.revealed .trans-block {
    max-height: 2000px;
    padding: 14px 20px 18px;
    border-top: 1px solid #eee5d5;
  }
  .trans-text {
    color: var(--text-light);
    font-size: 0.95em;
    padding-left: 20px;
    border-left: 3px solid var(--highlight-border);
  }
  .trans-label {
    font-size: 0.75em; color: #c0b090; margin-bottom: 6px;
    letter-spacing: 0.05em;
  }

  footer { text-align: center; padding: 40px; color: #c0b090; font-size: 0.85em; }

  #back-to-top {
    position: fixed; bottom: 30px; right: 30px; width: 44px; height: 44px;
    border-radius: 50%; border: none; background: var(--accent); color: #fff;
    font-size: 1.3em; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    opacity: 0; transform: translateY(20px); transition: all 0.3s; z-index: 200;
  }
  #back-to-top.visible { opacity: 1; transform: translateY(0); }
  #back-to-top:hover { background: #6b3410; }

  /* Highlight matching chars in translation */
  .trans-text .match-hl {
    background: rgba(205,133,63,0.15);
    border-radius: 2px;
    padding: 0 1px;
    transition: background 0.3s;
  }

  @media (max-width: 640px) {
    header h1 { font-size: 1.25em; }
    header { padding: 20px 16px 18px; }
    nav { top: 0; }
    nav a { padding: 8px 10px; font-size: 0.78em; }
    main { padding: 16px 10px 60px; }
    .orig-sent { font-size: 1em; }
    .orig-block { padding: 12px 14px 10px; }
    .para-group.revealed .trans-block { padding: 10px 14px 14px; }
  }
</style>
</head>
<body>
<header><h1>六祖坛经</h1><p>唐·惠能 述 &nbsp;/&nbsp; 原文·译文对照读本</p></header>
<nav id="toc"></nav>
<main id="content"></main>
<button id="back-to-top" title="回到顶部">&#9650;</button>
<footer><p>点击正文句子，显示对应译文</p></footer>
<script>
(function() {
  var CHAPTERS = ${chaptersJson};

  // Build TOC
  var toc = document.getElementById('toc');
  CHAPTERS.forEach(function(ch, i) {
    var a = document.createElement('a');
    a.href = '#chapter-' + i;
    a.textContent = ch.title;
    a.addEventListener('click', function(e) {
      e.preventDefault();
      var el = document.getElementById('chapter-' + i);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
    toc.appendChild(a);
  });

  var main = document.getElementById('content');

  CHAPTERS.forEach(function(ch, chIdx) {
    var section = document.createElement('section');
    section.className = 'chapter';
    section.id = 'chapter-' + chIdx;

    var title = document.createElement('h2');
    title.className = 'chapter-title';
    title.textContent = ch.title;
    section.appendChild(title);

    if (ch.pairedParas) {
      ch.pairedParas.forEach(function(pp) {
        var group = document.createElement('div');
        group.className = 'para-group';

        // Original text block
        var origBlock = document.createElement('div');
        origBlock.className = 'orig-block';

        if (pp.origSents && pp.origSents.length > 0) {
          pp.origSents.forEach(function(sent) {
            var span = document.createElement('span');
            span.className = 'orig-sent';
            span.textContent = sent;

            span.addEventListener('click', function(e) {
              e.stopPropagation();

              // Remove active from all sentences in this group
              var allSents = group.querySelectorAll('.orig-sent');
              for (var k = 0; k < allSents.length; k++) {
                allSents[k].classList.remove('active');
              }
              span.classList.add('active');

              // Reveal translation
              // Close all other groups in this chapter
              var allGroups = section.querySelectorAll('.para-group');
              for (var g = 0; g < allGroups.length; g++) {
                allGroups[g].classList.remove('revealed');
                var sents = allGroups[g].querySelectorAll('.orig-sent');
                for (var s = 0; s < sents.length; s++) {
                  sents[s].classList.remove('active');
                }
              }
              group.classList.add('revealed');
              span.classList.add('active');
            });

            origBlock.appendChild(span);
          });
        } else {
          origBlock.textContent = pp.orig;
        }

        // Translation block
        var transBlock = document.createElement('div');
        transBlock.className = 'trans-block';

        var transLabel = document.createElement('div');
        transLabel.className = 'trans-label';
        transLabel.textContent = '【译文】';

        var transText = document.createElement('div');
        transText.className = 'trans-text';
        transText.textContent = pp.trans;

        transBlock.appendChild(transLabel);
        transBlock.appendChild(transText);

        group.appendChild(origBlock);
        group.appendChild(transBlock);
        section.appendChild(group);
      });
    }

    main.appendChild(section);
  });

  // Back to top
  var backBtn = document.getElementById('back-to-top');
  window.addEventListener('scroll', function() {
    if (window.scrollY > 400) backBtn.classList.add('visible');
    else backBtn.classList.remove('visible');
  });
  backBtn.addEventListener('click', function() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Active nav
  var navLinks = document.querySelectorAll('nav a');
  window.addEventListener('scroll', function() {
    var current = -1;
    CHAPTERS.forEach(function(ch, i) {
      var el = document.getElementById('chapter-' + i);
      if (el && el.getBoundingClientRect().top <= 200) current = i;
    });
    navLinks.forEach(function(a, i) {
      if (i === current) a.classList.add('active');
      else a.classList.remove('active');
    });
  });
})();
</script>
</body>
</html>`;

    fs.writeFileSync(outputPath, html, 'utf-8');

    let totalParas = 0;
    for (const ch of chapters) {
        totalParas += (ch.pairedParas || []).length;
    }

    console.log(`Generated ${outputPath}`);
    console.log(`  Chapters: ${chapters.length}`);
    console.log(`  Paragraph pairs: ${totalParas}`);
    console.log(`  File size: ${(fs.statSync(outputPath).size / 1024).toFixed(0)} KB`);
}

function main() {
    console.log('Parsing 坛经.txt...');
    const chapters = parseFile(INPUT_FILE);
    console.log(`Found ${chapters.length} chapters\n`);

    for (const ch of chapters) {
        let totalOrig = 0, totalTrans = 0;
        for (const bp of ch.blockPairs) {
            totalOrig += bp.origParas.length;
            totalTrans += bp.transParas.length;
        }
        console.log(`  ${ch.title}: ${ch.blockPairs.length} blocks, ${totalOrig} orig / ${totalTrans} trans paragraphs`);
    }

    console.log('\nBuilding aligned data...');
    buildAlignedData(chapters);

    console.log('\nGenerating HTML...');
    generateHtml(chapters, OUTPUT_FILE);
    console.log('Done!');
}

main();
