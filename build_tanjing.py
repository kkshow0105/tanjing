#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Parse 坛经.txt and generate an interactive HTML file.
Click any original-text sentence to reveal its corresponding translation.
"""

import re
import json

INPUT_FILE = "坛经.txt"
OUTPUT_FILE = "坛经.html"

CHAPTER_NAMES = [
    "行由品第一", "般若品第二", "疑问品第三", "定慧品第四",
    "坐禅品第五", "忏悔品第六", "机缘品第七", "顿渐品第八",
    "护法品第九", "付嘱品第十",
]

def clean_text(text):
    """Remove annotation markers like [1], [2] from original text."""
    return re.sub(r'\[\d+\]', '', text)

def split_sentences(text):
    """Split Chinese text into sentences on 。！？； followed by optional newline.
    Keep the delimiter with the sentence."""
    if not text.strip():
        return []
    # Split on Chinese punctuation, keeping it at the end
    parts = re.split(r'(?<=[。！？；])', text)
    result = []
    for p in parts:
        p = p.strip()
        if p:
            result.append(p)
    return result

def is_chapter_header(line):
    for name in CHAPTER_NAMES:
        if name in line:
            return True
    return False

def parse_file(filepath):
    """Parse the 坛经 text into structured chapters with paired sentences."""
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Skip the table of contents (lines 0-28 approximately)
    # Find first chapter header
    start_idx = 0
    for i, line in enumerate(lines):
        line = line.strip()
        if line == "行由品第一":
            start_idx = i
            break

    chapters = []
    current_chapter = None
    # State machine:
    # 'chapter_start' -> 'tijie' -> 'original' -> 'comment' -> 'translation' -> 'original' -> ...
    state = 'chapter_start'
    current_original = []  # paragraphs of original text in current block
    current_translation = []  # paragraphs of translation in current block
    block_pairs = []  # list of (original_paragraphs, translation_paragraphs) for current chapter

    # The structure after a chapter header is:
    # 【题解】content (skip)
    # Then cycles of: original text paragraphs -> 【注释】content (skip) -> 【译文】paragraphs
    # Each chapter can have multiple such cycles.

    in_comment = False
    in_translation = False
    in_tijie = False
    post_tijie_original = False  # After 题解 but before first 注释

    i = start_idx
    while i < len(lines):
        line = lines[i].strip()
        raw = lines[i]

        # Detect chapter header
        if is_chapter_header(line) and not line.startswith('【'):
            # Save previous chapter
            if current_chapter is not None and block_pairs:
                current_chapter['blocks'] = block_pairs
                chapters.append(current_chapter)

            current_chapter = {
                'title': line,
                'blocks': []
            }
            block_pairs = []
            current_original = []
            current_translation = []
            state = 'chapter_start'
            in_comment = False
            in_translation = False
            in_tijie = False
            post_tijie_original = False
            i += 1
            continue

        if current_chapter is None:
            i += 1
            continue

        # 【题解】 starts
        if line == '【题解】':
            in_tijie = True
            in_comment = False
            in_translation = False
            post_tijie_original = False
            i += 1
            continue

        # 【注释】 starts - this marks the end of original text for this block
        if line == '【注释】':
            if post_tijie_original or (current_original and not in_translation):
                # Save the original text we've collected
                pass
            in_comment = True
            in_translation = False
            in_tijie = False
            post_tijie_original = False
            i += 1
            continue

        # 【译文】 starts - this marks the end of annotations, start of translation
        if line == '【译文】':
            in_comment = False
            in_translation = True
            in_tijie = False
            post_tijie_original = False
            i += 1
            continue

        # Skip blank lines
        if not line:
            # Blank line marker for paragraph separation
            if in_translation and current_translation:
                # Don't add empty paragraphs
                pass
            elif post_tijie_original and current_original:
                pass
            i += 1
            continue

        # Handle content based on state
        if in_tijie:
            # Skip 题解 content
            i += 1
            continue

        if in_comment:
            # Skip annotation content
            i += 1
            continue

        if in_translation:
            # When in translation mode and we hit a non-annotation, non-section content
            # that's not a chapter header, it's translation text
            # But if we encounter 【注释】 again, that means a new original block is starting
            # Actually, we should accumulate translation text
            if line == '【注释】':
                # End of translation, save the current block pair
                if current_original and current_translation:
                    block_pairs.append((list(current_original), list(current_translation)))
                current_original = []
                current_translation = []
                in_comment = True
                in_translation = False
                post_tijie_original = False
                i += 1
                continue

            # Check if this is a new original text starting (after translation, before next annotation)
            # Actually, after translation ends, the next content is original text.
            # But how do we detect it? The next 【注释】 marks new original text.
            # But before that, there might be 【题解】 of next chapter.

            if line == '【题解】':
                # New chapter starting
                if current_original and current_translation:
                    block_pairs.append((list(current_original), list(current_translation)))
                current_original = []
                current_translation = []
                in_tijie = True
                in_translation = False
                post_tijie_original = False
                i += 1
                continue

            # If it looks like a chapter header for next chapter
            if is_chapter_header(line) and line in CHAPTER_NAMES:
                if current_original and current_translation:
                    block_pairs.append((list(current_original), list(current_translation)))
                current_chapter['blocks'] = block_pairs
                chapters.append(current_chapter)
                current_chapter = {
                    'title': line,
                    'blocks': []
                }
                block_pairs = []
                current_original = []
                current_translation = []
                in_translation = False
                in_comment = False
                in_tijie = False
                post_tijie_original = False
                i += 1
                continue

            # This is translation text
            current_translation.append(line)
            i += 1
            continue

        # If we're not in any special section - this is original text
        # This happens right after 【题解】 (before first 【注释】) or after 【译文】 (before next 【注释】)
        if not in_comment and not in_translation and not in_tijie:
            if current_chapter is not None and not is_chapter_header(line):
                # Check if this looks like original text content (not a structural marker)
                if line == '【注释】':
                    in_comment = True
                    post_tijie_original = False
                    i += 1
                    continue
                if line == '【题解】' or line == '【译文】':
                    i += 1
                    continue

                current_original.append(line)
                post_tijie_original = True
                i += 1
                continue

        i += 1

    # Save last block of last chapter
    if current_chapter is not None:
        if current_original and current_translation:
            block_pairs.append((list(current_original), list(current_translation)))
        if block_pairs:
            current_chapter['blocks'] = block_pairs
        chapters.append(current_chapter)

    return chapters


def align_sentences(original_paras, translation_paras):
    """
    Given a list of original paragraphs and translation paragraphs,
    split each into sentences and return aligned pairs at the sentence level.
    Returns list of dicts: [{'orig': '...', 'trans': '...'}, ...]
    """
    # Combine paragraph lists into single text sequences for alignment
    orig_sentences = []
    for p_text in original_paras:
        cleaned = clean_text(p_text)
        sents = split_sentences(cleaned)
        orig_sentences.extend(sents)

    trans_sentences = []
    for p_text in translation_paras:
        sents = split_sentences(p_text)
        trans_sentences.extend(sents)

    # Align by position ratio
    pairs = []
    if not orig_sentences or not trans_sentences:
        return pairs

    # Map each original sentence to the translation sentences that best match
    n_orig = len(orig_sentences)
    n_trans = len(trans_sentences)

    if n_orig == 1 and n_trans == 1:
        pairs.append({'orig': orig_sentences[0], 'trans': trans_sentences[0]})
    elif n_orig == 1:
        pairs.append({'orig': orig_sentences[0], 'trans': ''.join(trans_sentences)})
    elif n_trans == 1:
        pairs.append({'orig': ''.join(orig_sentences), 'trans': trans_sentences[0]})
    else:
        # Use proportional mapping
        for j, os in enumerate(orig_sentences):
            # Determine the ratio range for this original sentence
            start_ratio = j / n_orig
            end_ratio = (j + 1) / n_orig

            # Find translation sentences that fall within this range
            t_start = int(start_ratio * n_trans)
            t_end = int(end_ratio * n_trans)
            if t_end <= t_start:
                t_end = t_start + 1
            t_end = min(t_end, n_trans)
            t_start = min(t_start, n_trans - 1)

            matched_trans = ''.join(trans_sentences[t_start:t_end])
            if matched_trans.strip():
                pairs.append({'orig': os, 'trans': matched_trans})

    return pairs


def build_sentence_map(chapters):
    """Build the complete sentence-aligned structure."""
    for ch in chapters:
        ch['aligned_blocks'] = []
        for orig_paras, trans_paras in ch.get('blocks', []):
            pairs = align_sentences(orig_paras, trans_paras)
            if pairs:
                ch['aligned_blocks'].append(pairs)


def generate_html(chapters, output_path):
    """Generate an interactive HTML file."""
    # Convert chapters to JSON for embedding
    chapters_json = json.dumps(chapters, ensure_ascii=False)

    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>六祖坛经 - 原文·译文对照</title>
<style>
  :root {{
    --bg: #f5f0e8;
    --card-bg: #fdfaf3;
    --text: #3d3226;
    --text-light: #6b5e4e;
    --accent: #8b4513;
    --accent-light: #cd853f;
    --highlight: #fff3cd;
    --highlight-border: #e6c450;
    --shadow: 0 2px 12px rgba(0,0,0,0.06);
    --radius: 8px;
  }}

  * {{ margin: 0; padding: 0; box-sizing: border-box; }}

  body {{
    font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", "KaiTi", serif;
    background: var(--bg);
    color: var(--text);
    line-height: 2;
    min-height: 100vh;
  }}

  header {{
    background: linear-gradient(135deg, #3d2b1f 0%, #5c3d2e 50%, #3d2b1f 100%);
    color: #f0e0c0;
    text-align: center;
    padding: 48px 24px 40px;
    position: sticky;
    top: 0;
    z-index: 100;
    box-shadow: 0 2px 20px rgba(0,0,0,0.3);
  }}

  header h1 {{
    font-size: 2.2em;
    font-weight: 700;
    letter-spacing: 0.15em;
    margin-bottom: 8px;
  }}

  header p {{
    font-size: 0.95em;
    opacity: 0.7;
    letter-spacing: 0.1em;
  }}

  nav {{
    background: #fff;
    border-bottom: 1px solid #e0d5c0;
    padding: 0;
    position: sticky;
    top: 134px;
    z-index: 99;
    overflow-x: auto;
    white-space: nowrap;
    box-shadow: 0 1px 8px rgba(0,0,0,0.05);
  }}

  nav a {{
    display: inline-block;
    padding: 12px 18px;
    color: var(--text-light);
    text-decoration: none;
    font-size: 0.9em;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }}

  nav a:hover, nav a.active {{
    color: var(--accent);
    border-bottom-color: var(--accent);
    background: #fdf8f0;
  }}

  main {{
    max-width: 900px;
    margin: 0 auto;
    padding: 32px 20px 80px;
  }}

  .chapter {{
    margin-bottom: 48px;
  }}

  .chapter-title {{
    font-size: 1.6em;
    color: var(--accent);
    text-align: center;
    padding: 32px 0 16px;
    border-bottom: 2px solid #d5c5a0;
    margin-bottom: 32px;
    letter-spacing: 0.1em;
  }}

  .block {{
    background: var(--card-bg);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    margin-bottom: 24px;
    overflow: hidden;
  }}

  .sentence-pair {{
    border-bottom: 1px solid #eee5d5;
    transition: background 0.3s;
  }}

  .sentence-pair:last-child {{
    border-bottom: none;
  }}

  .sentence-pair.active {{
    background: var(--highlight);
  }}

  .orig-sentence {{
    padding: 14px 20px 8px;
    cursor: pointer;
    color: var(--text);
    font-size: 1.1em;
    font-weight: 600;
    position: relative;
    transition: color 0.2s;
    user-select: none;
  }}

  .orig-sentence:hover {{
    color: var(--accent);
  }}

  .orig-sentence::before {{
    content: "经";
    font-size: 0.7em;
    color: var(--accent-light);
    margin-right: 8px;
    opacity: 0.6;
    font-weight: 400;
  }}

  .sentence-pair.active .orig-sentence::before {{
    content: "☞";
    opacity: 1;
    color: #c8a030;
  }}

  .trans-sentence {{
    padding: 4px 20px 14px 44px;
    color: var(--text-light);
    font-size: 0.95em;
    display: none;
    border-left: 3px solid transparent;
    transition: all 0.3s;
  }}

  .sentence-pair.active .trans-sentence {{
    display: block;
    border-left-color: var(--highlight-border);
  }}

  .sentence-pair.revealed .trans-sentence {{
    display: block;
  }}

  .sentence-number {{
    display: inline-block;
    min-width: 24px;
    font-size: 0.7em;
    color: #c0b090;
    margin-right: 6px;
  }}

  footer {{
    text-align: center;
    padding: 40px;
    color: #c0b090;
    font-size: 0.85em;
  }}

  @media (max-width: 640px) {{
    header h1 {{ font-size: 1.5em; }}
    header {{ padding: 28px 16px 24px; }}
    nav {{ top: 100px; }}
    nav a {{ padding: 10px 12px; font-size: 0.8em; }}
    main {{ padding: 16px 10px 60px; }}
    .orig-sentence {{ font-size: 1em; padding: 12px 16px 6px; }}
    .trans-sentence {{ padding: 4px 16px 12px 36px; }}
  }}

  .highlight-flash {{
    animation: flash 1s ease-out;
  }}

  @keyframes flash {{
    0%   {{ background-color: #ffe9a0; }}
    100% {{ background-color: transparent; }}
  }}

  #back-to-top {{
    position: fixed;
    bottom: 30px;
    right: 30px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: none;
    background: var(--accent);
    color: #fff;
    font-size: 1.3em;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    opacity: 0;
    transform: translateY(20px);
    transition: all 0.3s;
    z-index: 200;
  }}

  #back-to-top.visible {{
    opacity: 1;
    transform: translateY(0);
  }}

  #back-to-top:hover {{
    background: #6b3410;
  }}
</style>
</head>
<body>

<header>
  <h1>六祖坛经</h1>
  <p>唐·惠能 述 &nbsp;/&nbsp; 原文·译文对照读本</p>
</header>

<nav id="toc">
</nav>

<main id="content">
</main>

<button id="back-to-top" title="回到顶部">▲</button>

<footer>
  <p>点击正文句子，显示对应译文</p>
</footer>

<script>
  const CHAPTERS = {chapters_json};

  function buildTOC() {{
    const nav = document.getElementById('toc');
    CHAPTERS.forEach((ch, i) => {{
      const a = document.createElement('a');
      a.href = '#chapter-' + i;
      a.textContent = ch.title;
      a.addEventListener('click', (e) => {{
        e.preventDefault();
        document.getElementById('chapter-' + i).scrollIntoView({{ behavior: 'smooth' }});
      }});
      nav.appendChild(a);
    }});
  }}

  function buildContent() {{
    const main = document.getElementById('content');
    let globalPairIdx = 0;

    CHAPTERS.forEach((ch, chIdx) => {{
      const section = document.createElement('section');
      section.className = 'chapter';
      section.id = 'chapter-' + chIdx;

      const title = document.createElement('h2');
      title.className = 'chapter-title';
      title.textContent = ch.title;
      section.appendChild(title);

      if (ch.aligned_blocks) {{
        ch.aligned_blocks.forEach((pairs, blockIdx) => {{
          const block = document.createElement('div');
          block.className = 'block';

          pairs.forEach((pair, pairIdx) => {{
            const pairDiv = document.createElement('div');
            pairDiv.className = 'sentence-pair';
            pairDiv.setAttribute('data-pair-id', globalPairIdx);
            pairDiv.setAttribute('data-chapter', chIdx);

            const origDiv = document.createElement('div');
            origDiv.className = 'orig-sentence';
            origDiv.textContent = pair.orig;
            origDiv.title = '点击查看译文';

            const transDiv = document.createElement('div');
            transDiv.className = 'trans-sentence';
            transDiv.textContent = pair.trans;

            origDiv.addEventListener('click', () => {{
              // Toggle this pair
              const wasActive = pairDiv.classList.contains('revealed');
              // Close all pairs in the same block
              block.querySelectorAll('.sentence-pair').forEach(el => {{
                el.classList.remove('active', 'revealed');
              }});
              if (!wasActive) {{
                pairDiv.classList.add('active', 'revealed');
                pairDiv.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
              }}
            }});

            pairDiv.appendChild(origDiv);
            pairDiv.appendChild(transDiv);
            block.appendChild(pairDiv);
            globalPairIdx++;
          }});

          section.appendChild(block);
        }});
      }}

      main.appendChild(section);
    }});
  }}

  // Back to top button
  const backBtn = document.getElementById('back-to-top');
  window.addEventListener('scroll', () => {{
    if (window.scrollY > 400) {{
      backBtn.classList.add('visible');
    }} else {{
      backBtn.classList.remove('visible');
    }}
  }});
  backBtn.addEventListener('click', () => {{
    window.scrollTo({{ top: 0, behavior: 'smooth' }});
  }});

  // Highlight active nav link
  const navLinks = document.querySelectorAll('nav a');
  window.addEventListener('scroll', () => {{
    let current = '';
    CHAPTERS.forEach((ch, i) => {{
      const el = document.getElementById('chapter-' + i);
      if (el && el.getBoundingClientRect().top <= 200) {{
        current = i;
      }}
    }});
    navLinks.forEach((a, i) => {{
      a.classList.toggle('active', i == current);
    }});
  }});

  buildTOC();
  buildContent();
</script>

</body>
</html>'''

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)

    print(f"Generated {output_path}")
    print(f"  Chapters: {len(chapters)}")
    total_pairs = sum(
        sum(len(block) for block in ch.get('aligned_blocks', []))
        for ch in chapters
    )
    print(f"  Sentence pairs: {total_pairs}")


def main():
    print("Parsing 坛经.txt...")
    chapters = parse_file(INPUT_FILE)
    print(f"Found {len(chapters)} chapters")

    # Debug: print chapter info
    for ch in chapters:
        n_blocks = len(ch.get('blocks', []))
        total_orig = sum(len(o) for o, t in ch.get('blocks', []))
        total_trans = sum(len(t) for o, t in ch.get('blocks', []))
        print(f"  {ch['title']}: {n_blocks} blocks, {total_orig} orig paras, {total_trans} trans paras")

    print("Aligning sentences...")
    build_sentence_map(chapters)

    print("Generating HTML...")
    generate_html(chapters, OUTPUT_FILE)
    print("Done!")


if __name__ == '__main__':
    main()
