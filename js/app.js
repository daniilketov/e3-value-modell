import { names, model, isBox, sides, get, edgeById, children, interfaceOf, portsFor, addInterfacePort, blank, validate, loadModel, setModel, storeModel } from './model.js';
import { createDiagram } from './diagram.js';
import { bindInteractions, instructions, placementTools } from './interactions.js';

const $ = id => document.getElementById(id);
const diagram = $('diagram');
const stage = $('stage');
const view = { selected:null, mode:'select', source:null };
const canvas = createDiagram(diagram, view, $('counts'), $('empty'), $('grid'), $('zoom'));

try {
  loadModel();
} catch {
  $('storage').textContent = 'Could not restore the browser copy';
}

const icons = {
  actor:'<rect x="3" y="4" width="14" height="12" rx="1"/>',
  market:'<path d="M6 2h12v11M4 4h12v11"/><rect x="2" y="6" width="12" height="11" rx="1"/>',
  composite:'<rect x="2" y="3" width="16" height="14" rx="1" stroke-dasharray="2 2"/><rect x="5" y="7" width="4" height="6"/><rect x="11" y="7" width="4" height="6"/>',
  activity:'<rect x="2" y="5" width="16" height="10" rx="4"/>',
  interface:'<rect x="5" y="2" width="10" height="16" rx="4"/><path d="m7 6 4 2-4 2zm6 5-4 2 4 2z"/>',
  exchange:'<path d="M2 10h16m-4-4 4 4-4 4"/>',
  start:'<circle cx="10" cy="10" r="4" fill="currentColor"/>',
  stop:'<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3" fill="currentColor"/>',
  connect:'<path d="M3 10h14" stroke-dasharray="1 3"/><circle cx="2" cy="10" r="1"/><circle cx="18" cy="10" r="1"/>',
  undo:'<path d="M7 5 3 9l4 4M3 9h9a4 4 0 0 1 4 4v2"/>',
  redo:'<path d="m13 5 4 4-4 4m4-4H8a4 4 0 0 0-4 4v2"/>',
  minus:'<path d="M5 10h10"/>', plus:'<path d="M5 10h10m-5-5v10"/>',
  fit:'<path d="M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4"/><rect x="7" y="7" width="6" height="6"/>'
};
const icon = type => '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">'+icons[type]+'</svg>';

const undoStack = [];
const redoStack = [];

function saveLocal() {
  try {
    storeModel();
    $('storage').textContent = 'Changes saved in this browser';
  } catch {
    $('storage').textContent = 'Use Save model to keep your changes';
  }
}
function record(previous) {
  undoStack.push(previous);
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  saveLocal();
}
function change(action) {
  const before = JSON.stringify(model);
  action();
  if (JSON.stringify(model) !== before) record(before);
  render();
}
function restore(from,to) {
  if (!from.length) return;
  to.push(JSON.stringify(model));
  setModel(JSON.parse(from.pop()));
  if (view.mode === 'port-exchange') {
    view.mode = 'select';
    notice(instructions.select);
  }
  view.selected = null;
  view.source = null;
  saveLocal();
  render();
}
function notice(text,error = false) {
  $('message').textContent = text;
  $('message').dataset.error = error;
}
function setMode(next) {
  view.mode = next;
  diagram.style.cursor = '';
  view.source = null;
  notice(instructions[view.mode]+(placementTools.includes(view.mode) ? ' Hold Shift to place multiple.' : ''));
  render();
}

function button(label,action,css = '') {
  const el = document.createElement('button');
  el.textContent = label;
  el.className = css;
  el.addEventListener('click',action);
  return el;
}
function field(label,value,update,options = {}) {
  const row = document.createElement('label');
  row.textContent = label;
  const input = document.createElement(options.choices ? 'select' : 'input');
  if (options.choices) {
    for (const [key,text] of options.choices) input.add(new Option(text,key));
  } else {
    input.type = options.type || 'text';
    input.maxLength = 100;
    if (options.min) input.min = options.min;
    if (options.step) input.step = options.step;
  }
  input.value = value ?? '';
  if (options.rename) {
    input.dataset.rename = '';
    input.addEventListener('keydown',event => {
      if (event.key === 'Enter') input.blur();
      if (event.key === 'Escape') input.value = value ?? '';
    });
  }
  input.addEventListener('change',() => {
    if (input.reportValidity()) update(options.type === 'number' ? input.valueAsNumber : input.value);
  });
  row.append(input);
  return row;
}
function hint(text,css = 'hint') {
  const el = document.createElement('p');
  el.className = css;
  el.textContent = text;
  return el;
}
function subtitle(text) {
  const el = document.createElement('h3');
  el.textContent = text;
  return el;
}
function select(id) {
  view.mode = 'select';
  view.source = null;
  view.selected = id;
  notice(instructions.select);
  render({redraw:false});
}
function rename(id) {
  if (!id) return;
  if (view.selected !== id) select(id);
  const input = $('properties').querySelector('[data-rename]');
  if (input) {
    input.focus();
    input.select();
  }
}
function setProperty(item,key,value) {
  change(() => item[key] = value);
}
function addPort(iface,direction) {
  change(() => {
    addInterfacePort(model.nodes,iface,direction);
    view.selected = iface.id;
    view.mode = 'select';
    view.source = null;
    notice(instructions.select);
  });
}
function isRequiredPort(node) {
  return node?.type === 'port' && children(node.parent).length <= 1;
}
function remove(id,selection = null) {
  if (isRequiredPort(get(id))) {
    notice('A Value Interface needs at least one incoming and one outgoing port.',true);
    return;
  }
  change(() => {
    const gone = new Set();
    function collect(nodeId) {
      gone.add(nodeId);
      children(nodeId).forEach(child => collect(child.id));
    }
    collect(id);
    model.nodes = model.nodes.filter(node => !gone.has(node.id));
    model.edges = model.edges.filter(edge => ![edge.id,edge.from,edge.to].some(value => gone.has(value)));
    view.selected = selection;
    if (view.mode === 'port-exchange') view.mode = 'select';
    view.source = null;
    notice('Element deleted. Use Undo to restore it.');
  });
}
function renderProperties() {
  const container = $('properties');
  container.replaceChildren();
  const node = get(view.selected);
  const edge = edgeById(view.selected);
  const item = node || edge;
  if (!item) {
    const panel = document.createElement('div');
    panel.className = 'empty-inspector';
    panel.append(subtitle('No element selected'),hint('Select an element to edit its properties.'));
    container.append(panel);
    return;
  }
  container.append(subtitle(names[item.type]));
  if (isBox(node)) {
    container.append(field('Name',node.name,value => setProperty(node,'name',value),{rename:true}));
  }
  if (node?.parent) {
    const parent = node.type === 'port' ? interfaceOf(node) : get(node.parent);
    container.append(button('Select '+names[parent.type],() => select(parent.id),'full'));
  }
  if (isBox(node)) {
    const dimensions = document.createElement('div');
    dimensions.className = 'row';
    for (const [label,key,min] of [['Width','w',100],['Height','h',75]]) {
      dimensions.append(field(label,node[key],value => {
        if (Number.isFinite(value)) setProperty(node,key,value);
      },{type:'number',min,step:'any'}));
    }
    container.append(dimensions);
    const items = children(node.id);
    if (items.length) {
      const list = document.createElement('div');
      list.className = 'subsection';
      list.append(subtitle('Contained elements'));
      for (const child of items) list.append(button(child.name || names[child.type],() => select(child.id),'entry'));
      container.append(list);
    }
    if (node.type === 'composite') container.append(hint('Place partner Actors inside this box. Attach the shared Value Interface to its border.'));
  }
  if (node?.type === 'interface') {
    container.append(field('Side',node.side,value => setProperty(node,'side',value),{choices:sides.map(side => [side,side[0].toUpperCase()+side.slice(1)])}));
    const list = document.createElement('div');
    list.className = 'subsection';
    list.append(subtitle('Value Ports'));
    for (const [direction,label] of [['out','Outgoing'],['in','Incoming']]) {
      const ports = portsFor(node,direction);
      const entry = document.createElement('div');
      entry.className = 'port-stepper';
      const count = document.createElement('span');
      count.textContent = label+' ('+ports.length+')';
      const minus = button('−',() => remove(ports.at(-1).id,node.id));
      const plus = button('+',() => addPort(node,direction));
      minus.disabled = ports.length <= 1;
      minus.setAttribute('aria-label','Remove '+label.toLowerCase()+' port');
      plus.setAttribute('aria-label','Add '+label.toLowerCase()+' port');
      entry.append(count,minus,plus);
      list.append(entry);
    }
    container.append(list);
  }
  if (node?.type === 'port') {
    container.append(hint(get(node.parent).direction === 'in' ? 'Incoming port' : 'Outgoing port'));
    const links = model.edges.filter(link => link.from === node.id || link.to === node.id);
    for (const link of links) container.append(button(link.name || names[link.type],() => select(link.id),'entry'));
  }
  if (edge?.type === 'exchange') container.append(field('Value Object',edge.name,value => setProperty(edge,'name',value),{rename:true}));
  if (edge) {
    const endpoints = document.createElement('div');
    endpoints.className = 'row';
    endpoints.append(button('Select source',() => select(edge.from)),button('Select target',() => select(edge.to)));
    container.append(endpoints);
  }
  const deleteButton = button('Delete element',() => remove(item.id),'remove full');
  if (isRequiredPort(node)) {
    deleteButton.disabled = true;
    container.append(hint('Each interface needs one port in each direction.'));
  }
  container.append(deleteButton);
}
function render({redraw = true} = {}) {
  if (redraw) canvas.draw();
  else canvas.updateSelection();
  renderProperties();
  if (document.activeElement !== $('model-title')) $('model-title').value = model.title;
  $('undo').disabled = !undoStack.length;
  $('redo').disabled = !redoStack.length;
  stage.dataset.mode = view.mode === 'select' ? view.mode : 'draw';
  for (const tool of document.querySelectorAll('[data-tool]')) tool.setAttribute('aria-pressed',view.mode === tool.dataset.tool);
}
const sections = [
  ['Participants',['actor','market','composite','activity']],
  ['Value exchange',['interface','exchange']],
  ['Value scenario',['start','stop','connect']]
];
for (const [label,tools] of sections) {
  const section = document.createElement('div');
  section.className = 'section';
  section.style.setProperty('--tool-count',tools.length);
  section.append(subtitle(label));
  for (const type of tools) {
    const entry = button(names[type],() => setMode(type));
    entry.dataset.tool = type;
    entry.insertAdjacentHTML('afterbegin',icon(type));
    section.append(entry);
  }
  $('palette').append(section);
}
for (const [id,type] of [['undo','undo'],['redo','redo'],['zoom-out','minus'],['zoom-in','plus'],['fit','fit']]) {
  $(id).insertAdjacentHTML('afterbegin',icon(type));
}
$('undo').onclick = () => restore(undoStack,redoStack);
$('redo').onclick = () => restore(redoStack,undoStack);
$('zoom-in').onclick = () => canvas.zoomBy(1.2);
$('zoom-out').onclick = () => canvas.zoomBy(1/1.2);
$('fit').onclick = canvas.fit;
$('model-title').addEventListener('change',event => {
  const title = event.target.value.trim() || 'Untitled model';
  change(() => model.title = title);
  event.target.value = title;
});
function replaceModel(next) {
  change(() => {
    setModel(next);
    view.selected = null;
    view.source = null;
    view.mode = 'select';
  });
  notice(instructions.select);
  canvas.fit();
}
$('new-model').onclick = () => replaceModel(blank());
$('open-model').onclick = () => $('file').click();
$('file').addEventListener('change',async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    replaceModel(validate(JSON.parse(await file.text())));
    notice('Model opened.');
  } catch (error) {
    notice(error instanceof SyntaxError ? 'This file does not contain valid JSON.' : error.message,true);
  } finally {
    event.target.value = '';
  }
});
$('save-model').onclick = () => {
  const file = new Blob([JSON.stringify(model,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = (model.title.trim().replace(/[^\p{L}\p{N}._ -]/gu,'-') || 'value-model')+'.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
  notice('Model downloaded.');
};
const isDragging = bindInteractions(diagram, stage, canvas, view, { change, record, notice, render, select, rename });

document.addEventListener('keydown',event => {
  if (event.key === 'Escape') {
    setMode('select');
    return;
  }
  if (event.target.closest('input, select, textarea') || isDragging()) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) restore(redoStack,undoStack);
    else restore(undoStack,redoStack);
  }
  if (view.selected && (event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault();
    remove(view.selected);
  }
});
notice(instructions.select);
render();
requestAnimationFrame(canvas.fit);
