import { names, model, isBox, isStimulus, sides, get, edgeById, children, uid, blank, validate, loadModel, setModel, storeModel } from './model.js';
import { createDiagram } from './diagram.js';
import { bindInteractions, instructions } from './interactions.js';

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
  offering:'<path d="M6 3H3v14h3m2-12 5 2-5 2zm0 6 5 2-5 2z"/>',
  port:'<path d="m6 4 10 6-10 6z"/>',
  exchange:'<path d="M2 10h16m-4-4 4 4-4 4"/>',
  start:'<circle cx="10" cy="10" r="4" fill="currentColor"/>',
  stop:'<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3" fill="currentColor"/>',
  connect:'<path d="M3 10h14" stroke-dasharray="1 3"/><circle cx="2" cy="10" r="1"/><circle cx="18" cy="10" r="1"/>',
  select:'<path d="m4 2 12 9-6 1-2 6z"/>',
  pan:'<path d="M6 10V5a1 1 0 0 1 2 0v4-6a1 1 0 0 1 2 0v6-5a1 1 0 0 1 2 0v5-3a1 1 0 0 1 2 0v7a4 4 0 0 1-4 4H9c-1.5 0-2.4-.7-3.1-1.7l-2.4-3.4a1.2 1.2 0 0 1 1.8-1.5L6 11"/>',
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
  notice(instructions[view.mode]);
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
function offeringFor(iface,direction) {
  return children(iface.id).find(node => node.direction === direction);
}
function addOffering(iface,direction,withPort) {
  change(() => {
    let offering = offeringFor(iface,direction);
    if (!offering) {
      offering = {id:uid(),type:'offering',parent:iface.id,direction};
      model.nodes.push(offering);
    }
    view.selected = offering.id;
    if (withPort) {
      const port = {id:uid(),type:'port',parent:offering.id};
      model.nodes.push(port);
      view.selected = port.id;
    }
    view.mode = 'select';
    view.source = null;
    notice(instructions.select);
  });
}
function remove(id) {
  change(() => {
    const gone = new Set();
    function collect(nodeId) {
      gone.add(nodeId);
      children(nodeId).forEach(child => collect(child.id));
    }
    collect(id);
    model.nodes = model.nodes.filter(node => !gone.has(node.id));
    model.edges = model.edges.filter(edge => ![edge.id,edge.from,edge.to].some(value => gone.has(value)));
    view.selected = null;
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
  if (isBox(node) || isStimulus(node) || node?.type === 'interface') {
    container.append(field('Name',node.name,value => setProperty(node,'name',value),{rename:true}));
  }
  if (node?.parent) {
    const parent = get(node.parent);
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
    list.append(subtitle('Value Offerings'));
    if (view.mode === 'offering' || view.mode === 'port') {
      list.append(hint(view.mode === 'offering' ? 'Choose the direction of the offering.' : 'Choose the direction of the port.'));
    }
    for (const [direction,label] of [['out','Outgoing'],['in','Incoming']]) {
      const offering = offeringFor(node,direction);
      const entry = document.createElement('div');
      entry.className = 'row';
      const pick = button(offering ? label+' ('+children(offering.id).length+')' : 'Add '+label.toLowerCase(),() => {
        if (view.mode === 'port') addOffering(node,direction,true);
        else if (offering) select(offering.id);
        else addOffering(node,direction,false);
      });
      entry.append(pick,button('+ Port',() => addOffering(node,direction,true)));
      list.append(entry);
      entry.style.marginBottom = '6px';
    }
    list.append(hint('Ports in the same direction form one offering. Group them in this interface to model a bundle.'));
    container.append(list);
  }
  if (node?.type === 'offering') {
    container.append(hint(node.direction === 'in' ? 'Incoming' : 'Outgoing'));
    container.append(button('Add Value Port',() => addOffering(get(node.parent),node.direction,true),'full'));
    const ports = children(node.id);
    ports.forEach((port,i) => container.append(button('Value Port '+(i+1),() => select(port.id),'entry')));
  }
  if (node?.type === 'port') {
    container.append(hint(get(node.parent).direction === 'in' ? 'Incoming port' : 'Outgoing port'));
    const exchanges = model.edges.filter(link => link.from === node.id || link.to === node.id);
    for (const exchange of exchanges) container.append(button(exchange.name || names.exchange,() => select(exchange.id),'entry'));
  }
  if (edge?.type === 'exchange') container.append(field('Value Object',edge.name,value => setProperty(edge,'name',value),{rename:true}));
  if (edge) {
    const endpoints = document.createElement('div');
    endpoints.className = 'row';
    endpoints.append(button('Select source',() => select(edge.from)),button('Select target',() => select(edge.to)));
    container.append(endpoints);
  }
  container.append(button('Delete element',() => remove(item.id),'remove full'));
}
function render({redraw = true} = {}) {
  if (redraw) canvas.draw();
  else canvas.updateSelection();
  renderProperties();
  if (document.activeElement !== $('model-title')) $('model-title').value = model.title;
  $('undo').disabled = !undoStack.length;
  $('redo').disabled = !redoStack.length;
  stage.dataset.mode = ['pan','select'].includes(view.mode) ? view.mode : 'draw';
  for (const tool of document.querySelectorAll('[data-tool]')) tool.setAttribute('aria-pressed',view.mode === tool.dataset.tool);
}
const sections = [
  ['Participants',['actor','market','composite','activity']],
  ['Value exchange',['interface','offering','port','exchange']],
  ['Value scenario',['start','stop','connect']]
];
for (const [label,tools] of sections) {
  const section = document.createElement('div');
  section.className = 'section';
  section.append(subtitle(label));
  for (const type of tools) {
    const entry = button(names[type],() => setMode(type));
    entry.dataset.tool = type;
    entry.insertAdjacentHTML('afterbegin',icon(type));
    section.append(entry);
  }
  $('palette').append(section);
}
for (const [id,type] of [['select-tool','select'],['pan-tool','pan'],['undo','undo'],['redo','redo'],['zoom-out','minus'],['zoom-in','plus'],['fit','fit']]) {
  $(id).insertAdjacentHTML('afterbegin',icon(type));
}
for (const type of ['select','pan']) {
  $(type+'-tool').dataset.tool = type;
  $(type+'-tool').setAttribute('aria-label',type === 'select' ? 'Select' : 'Pan');
  $(type+'-tool').addEventListener('click',() => setMode(type));
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
