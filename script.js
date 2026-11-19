const $ = id => document.getElementById(id);

const APP_REPO = "vicholz/math-sheet-generator";

function loadAppVersion() {
  fetch("https://api.github.com/repos/" + APP_REPO + "/commits/main")
    .then((res) => {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    })
    .then((commit) => {
      if (!commit.sha) return;
      const el = $("app-version");
      if (!el) return;
      el.replaceChildren();
      el.append("Version ");
      const a = document.createElement("a");
      a.href = "https://github.com/" + APP_REPO + "/commit/" + commit.sha;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = commit.sha.slice(0, 7);
      el.appendChild(a);
      el.hidden = false;
    })
    .catch(() => {});
}

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[rand(0, arr.length - 1)];

let problems = [];
let interactive = false;
let showWork = false;
let showKey = false;
let allowAnswerKey = false;

// Compression + base64url helpers (uses CompressionStream for gzip)
async function compressToBase64(obj) {
  const json = JSON.stringify(obj);
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(new TextEncoder().encode(json));
  writer.close();
  const buf = await new Response(stream.readable).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decompressFromBase64(b64) {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buf = await new Response(stream.readable).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(buf));
}

function getShareState() {
  return {
    grade: $('grade').value,
    count: parseInt($('count').value),
    types: getSelectedTypes(),
    showWork: $('show-work').checked,
    showKey: $('show-key').checked,
    problems: problems.map(p => ({
      text: p.text, answer: p.answer, type: p.type, display: p.display || null,
      needsWork: !!p.needsWork, vertical: p.vertical || null, a: p.a ?? null, b: p.b ?? null
    }))
  };
}

async function applyShareState(state) {
  if (!state) return false;
  $('grade').value = state.grade || '3';
  $('count').value = String(state.count || 20);
  const typeSet = new Set(state.types || []);
  ['add','sub','mul','div','sqrt','alg','word'].forEach(t => {
    const el = $(`type-${t}`);
    if (el) el.checked = typeSet.has(t);
  });
  $('show-work').checked = !!state.showWork;
  if (allowAnswerKey) {
    $('show-key').checked = !!state.showKey;
  }
  if (Array.isArray(state.problems) && state.problems.length) {
    problems = state.problems.map((p, i) => ({ ...p, id: i }));
    interactive = false;
    render();
    return true;
  }
  return false;
}

async function shareLink() {
  if (!problems.length) {
    alert('Generate a sheet first.');
    return;
  }
  try {
    const data = await compressToBase64(getShareState());
    const url = new URL(location.href);
    url.searchParams.set('sheet', data);
    url.hash = '';
    await navigator.clipboard.writeText(url.toString());
    alert('Share link copied to clipboard.');
  } catch (e) {
    console.error(e);
    alert('Failed to create share link. Try a modern browser.');
  }
}

async function loadFromQuery() {
  const params = new URLSearchParams(location.search);
  allowAnswerKey = params.get('answer_key') === 'true';
  const keyWrap = $('show-key-wrap');
  if (keyWrap) keyWrap.hidden = !allowAnswerKey;

  const data = params.get('sheet');
  if (!data) return false;
  try {
    const state = await decompressFromBase64(data);
    return await applyShareState(state);
  } catch (e) {
    console.error('Failed to load sheet from URL', e);
    return false;
  }
}

function getDifficulty(grade) {
  const g = parseInt(grade);
  if (g <= 2) return { max: 10, digits: 1, allowNeg: false, alg: false, sqrt: false };
  if (g <= 4) return { max: 20, digits: 2, allowNeg: false, alg: false, sqrt: g >= 4 };
  if (g <= 6) return { max: 100, digits: 2, allowNeg: g >= 6, alg: g >= 6, sqrt: true };
  if (g <= 8) return { max: 200, digits: 3, allowNeg: true, alg: true, sqrt: true };
  return { max: 500, digits: 3, allowNeg: true, alg: true, sqrt: true };
}

function generateAddition(d) {
  const a = rand(1, d.max);
  const b = rand(1, d.max);
  return { text: `${a} + ${b} =`, answer: a + b, type: 'add' };
}
function generateSubtraction(d) {
  let a = rand(1, d.max);
  let b = rand(1, d.max);
  if (!d.allowNeg && a < b) [a, b] = [b, a];
  return { text: `${a} - ${b} =`, answer: a - b, type: 'sub' };
}
function generateMultiplication(d) {
  const maxFactor = Math.min(12, Math.floor(d.max / 2) || 12);
  const a = rand(1, maxFactor);
  const b = rand(1, maxFactor);
  return { text: `${a} × ${b} =`, answer: a * b, type: 'mul', needsWork: true, vertical: 'mul', a, b };
}
function generateDivision(d) {
  const g = parseInt($('grade').value) || 3;
  // Long division (needs work) from grade 3 up; simple facts below that
  if (g >= 3) {
    const b = rand(2, g >= 5 ? 12 : 9);
    const ans = rand(g >= 5 ? 10 : 4, g >= 6 ? 40 : 16);
    const a = b * ans;
    return { text: `${a} ÷ ${b} =`, answer: ans, type: 'div', needsWork: true, vertical: 'div', a, b };
  }
  const b = rand(2, 9);
  const ans = rand(1, 9);
  const a = b * ans;
  return { text: `${a} ÷ ${b} =`, answer: ans, type: 'div', needsWork: false, a, b };
}
function generateSqrt(d) {
  const n = rand(1, Math.min(20, Math.floor(Math.sqrt(d.max))));
  const sq = n * n;
  return { text: `√${sq} =`, answer: n, type: 'sqrt', needsWork: true, vertical: 'sqrt', a: sq };
}
function generateAlgebra(d) {
  const x = rand(1, 12);
  const c = rand(1, 15);
  const a = rand(1, 8);
  const style = rand(0, 1);
  if (style === 0) {
    const result = a * x + c;
    return { text: `${a}x + ${c} = ${result}`, answer: x, type: 'alg', display: `x =` };
  } else {
    const result = x + c;
    return { text: `x + ${c} = ${result}`, answer: x, type: 'alg', display: `x =` };
  }
}
function generateWord(d) {
  const templates = [
    () => {
      const a = rand(2, 15), b = rand(2, 15);
      return { text: `There are ${a} apples. ${b} more are added. How many apples in total?`, answer: a + b };
    },
    () => {
      const a = rand(5, 30), b = rand(1, Math.min(a-1, 15));
      return { text: `A store has ${a} books. ${b} are sold. How many remain?`, answer: a - b };
    },
    () => {
      const a = rand(2, 10), b = rand(2, 8);
      return { text: `Each box holds ${a} pencils. There are ${b} boxes. How many pencils total?`, answer: a * b };
    },
    () => {
      const b = rand(2, 8), ans = rand(2, 10);
      return { text: `${b * ans} cookies are shared equally among ${b} friends. How many each?`, answer: ans };
    }
  ];
  const t = pick(templates)();
  return { ...t, type: 'word' };
}

const generators = {
  add: generateAddition,
  sub: generateSubtraction,
  mul: generateMultiplication,
  div: generateDivision,
  sqrt: generateSqrt,
  alg: generateAlgebra,
  word: generateWord
};

function getSelectedTypes() {
  const types = [];
  if ($('type-add').checked) types.push('add');
  if ($('type-sub').checked) types.push('sub');
  if ($('type-mul').checked) types.push('mul');
  if ($('type-div').checked) types.push('div');
  if ($('type-sqrt').checked) types.push('sqrt');
  if ($('type-alg').checked) types.push('alg');
  if ($('type-word').checked) types.push('word');
  return types.length ? types : ['add'];
}

function generateProblems() {
  const grade = $('grade').value;
  const count = parseInt($('count').value);
  const types = getSelectedTypes();
  const d = getDifficulty(grade);
  const available = types.filter(t => {
    if (t === 'alg' && !d.alg) return false;
    if (t === 'sqrt' && !d.sqrt) return false;
    return true;
  });
  const useTypes = available.length ? available : ['add', 'sub'];

  problems = [];
  for (let i = 0; i < count; i++) {
    const type = pick(useTypes);
    const p = generators[type](d);
    p.id = i;
    problems.push(p);
  }
  render();
}

function render() {
  const container = $('problems');
  container.innerHTML = '';
  const grade = $('grade').value;
  $('meta').textContent = `Grade ${grade} • ${problems.length} problems`;
  showWork = $('show-work').checked;
  showKey = allowAnswerKey && $('show-key').checked && !interactive;

  function verticalHtml(p) {
    if (p.vertical === 'mul') {
      return `<div class="vprob mul">
        <div class="vrow"><span class="vnum">${p.a}</span></div>
        <div class="vrow op"><span class="vop">×</span><span class="vnum">${p.b}</span></div>
        <div class="vbar"></div>
      </div>`;
    }
    if (p.vertical === 'div') {
      return `<div class="vprob div">
        <div class="ldiv">
          <div class="ldiv-top"></div>
          <div class="ldiv-row">
            <span class="ldiv-div">${p.b}</span>
            <span class="ldiv-bracket">)</span>
            <span class="ldiv-num">${p.a}</span>
          </div>
        </div>
      </div>`;
    }
    if (p.vertical === 'sqrt') {
      return `<div class="vprob sqrt">
        <div class="radical"><span class="radical-sign">√</span><span class="radical-num">${p.a}</span></div>
      </div>`;
    }
    return '';
  }

  problems.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'problem' + (showWork && p.vertical ? ' has-vertical' : '');
    div.dataset.id = p.id;
    const wantWork = showWork && p.needsWork;

    let html = `<span class="problem-num">${i + 1}.</span>`;
    if (showWork && p.vertical) {
      html += verticalHtml(p);
    } else {
      html += `<span class="expression">${p.text}</span>`;
    }

    if (interactive) {
      const ansLabel = p.display || '=';
      html += ` <input type="text" class="answer-input" data-id="${p.id}" placeholder="${ansLabel}" autocomplete="off">`;
      if (wantWork) {
        html += `<textarea class="work-textarea" data-id="${p.id}" placeholder="Show your work here..."></textarea>`;
      }
    } else {
      if (showKey) {
        const ansText = p.display ? `${p.display} ${p.answer}` : p.answer;
        html += ` <span class="answer-line filled-answer">${ansText}</span>`;
      } else {
        html += ` <span class="answer-line"></span>`;
      }
      if (wantWork) {
        html += `<div class="work-box"></div>`;
      }
    }
    div.innerHTML = html;
    container.appendChild(div);
  });

  const keyEl = $('answer-key');
  const listEl = $('answer-list');
  if (showKey && problems.length) {
    listEl.innerHTML = problems.map((p, i) => {
      const ans = p.display ? `${p.display} ${p.answer}` : p.answer;
      return `<div class="answer-item"><span class="num">${i + 1}.</span><span>${ans}</span></div>`;
    }).join('');
    keyEl.classList.remove('hidden');
  } else {
    keyEl.classList.add('hidden');
  }

  $('score').classList.add('hidden');
  document.body.classList.toggle('interactive', interactive);
  $('grade-btn').classList.toggle('hidden', !interactive);
  $('interactive').textContent = interactive ? 'Print Mode' : 'Interactive Mode';
}

function gradeAnswers() {
  if (!interactive) return;
  let correct = 0;
  let incomplete = false;

  problems.forEach(p => {
    const input = document.querySelector(`.answer-input[data-id="${p.id}"]`);
    const work = document.querySelector(`.work-textarea[data-id="${p.id}"]`);
    if (!input) return;

    const val = input.value.trim();
    const userAns = parseFloat(val);
    const isCorrect = !isNaN(userAns) && Math.abs(userAns - p.answer) < 0.001;

    if (p.needsWork && work && work.value.trim() === '') {
      incomplete = true;
      work.classList.add('incorrect');
    } else if (work) {
      work.classList.remove('incorrect');
    }

    input.classList.remove('correct', 'incorrect');
    if (val === '') {
      incomplete = true;
      input.classList.add('incorrect');
    } else if (isCorrect) {
      correct++;
      input.classList.add('correct');
    } else {
      input.classList.add('incorrect');
    }
  });

  const scoreEl = $('score');
  if (incomplete) {
    scoreEl.textContent = 'Please fill all answer fields' + (problems.some(p => p.needsWork && showWork) ? ' and required work boxes' : '') + ' before grading.';
    scoreEl.classList.remove('hidden');
    return;
  }
  scoreEl.textContent = `Score: ${correct} / ${problems.length} (${Math.round(correct / problems.length * 100)}%)`;
  scoreEl.classList.remove('hidden');
}

$('generate').onclick = () => {
  interactive = false;
  generateProblems();
};
$('print').onclick = () => window.print();
$('share').onclick = shareLink;
$('interactive').onclick = () => {
  interactive = !interactive;
  if (problems.length === 0) generateProblems();
  else render();
};
$('grade-btn').onclick = gradeAnswers;

loadAppVersion();
loadFromQuery().then(loaded => {
  if (!loaded) generateProblems();
});
