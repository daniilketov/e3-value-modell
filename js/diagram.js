import { names, model, isActor, isBox, isStimulus, get, children, interfaceOf } from './model.js';

const interfaceHalfWidth = 12;
const portSpacing = 30;
const svgNS = 'http://www.w3.org/2000/svg';
const sideAngles = {left:0,right:0,top:90,bottom:90};
const normals = {left:{x:-1,y:0},right:{x:1,y:0},top:{x:0,y:-1},bottom:{x:0,y:1}};
const horizontal = side => side === 'top' || side === 'bottom';
const symbolScale = node => node.size ?? 1;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
function position(node) {
  const parent = get(node.parent);
  if (node.type === 'interface') {
    const base = position(parent);
    return horizontal(node.side)
      ? {x:base.x+node.offset*parent.w,y:base.y+(node.side === 'bottom' ? parent.h : 0)}
      : {x:base.x+(node.side === 'right' ? parent.w : 0),y:base.y+node.offset*parent.h};
  }
  if (node.type === 'port') {
    const iface = get(get(node.parent).parent);
    const center = position(iface);
    const layout = portLayout(iface).find(item => item.port.id === node.id);
    const offset = layout.y*symbolScale(iface);
    return horizontal(iface.side) ? {x:center.x-offset,y:center.y} : {x:center.x,y:center.y+offset};
  }
  const base = parent ? position(parent) : {x:0,y:0};
  return {x:base.x+node.x,y:base.y+node.y};
}
function portLayout(iface) {
  const positive = iface.side === 'right' || iface.side === 'bottom';
  const groups = children(iface.id).sort((a,b) => positive ? b.direction.localeCompare(a.direction) : a.direction.localeCompare(b.direction));
  const ports = groups.flatMap(group => children(group.id).map(port => ({port,direction:group.direction})));

  return ports.map((item,index) => ({...item,y:(index-(ports.length-1)/2)*portSpacing}));
}
function interfaceHeight(count) {
  return Math.max(30,(count-1)*portSpacing+30);
}
const stimulusRadius = node => node.type === 'stop' ? 10 : 7;

function createDiagram(diagram, view, counts, empty, grid, zoom) {
  const world = diagram.querySelector('#world');
  let camera = {x:0,y:0,scale:1};

  function S(tag,attrs = {},content) {
    const element = document.createElementNS(svgNS,tag);
    for (const [key,value] of Object.entries(attrs)) element.setAttribute(key,value);
    if (content !== undefined) element.textContent = content;
    return element;
  }
  function group(item,css) {
    return S('g',{'data-id':item.id,class:css+(view.selected === item.id?' active':'')+(view.source === item.id?' source':'')});
  }
  function shorten(text,max) {
    return text.length <= max ? text : text.slice(0,Math.max(1,max-1))+'…';
  }
  function drawBox(node) {
    const point = position(node);
    const g = group(node,'element');
    g.setAttribute('transform','translate('+point.x+' '+point.y+')');
    const colors = node.type === 'activity' ? ['#eaf3ed','#759487']
      : node.type === 'market' ? ['#f0f1e6','#7f8968']
      : node.type === 'composite' ? ['#dfe9df','#75877d'] : ['#fbfcf9','#75877d'];
    if (node.type === 'market') {
      for (const shift of [10,5]) g.append(S('rect',{x:shift,y:-shift,width:node.w,height:node.h,fill:colors[0],stroke:colors[1],class:'symbol'}));
    }
    const rect = S('rect',{width:node.w,height:node.h,rx:node.type === 'activity' ? 12 : 1,fill:colors[0],stroke:colors[1],class:'symbol'});
    if (node.type === 'composite') {
      rect.setAttribute('stroke-dasharray','5 4');
      rect.setAttribute('pointer-events','all');
    }
    g.append(rect,S('title',{},node.name || names[node.type]),
      S('text',{x:13,y:25,class:'title'},shorten(node.name || names[node.type],Math.max(names[node.type].length,Math.floor((node.w-24)/7)))));
    world.append(g);
  }
  function drawInterface(node) {
    const p = position(node);
    const ports = portLayout(node);
    const height = interfaceHeight(ports.length);
    const g = group(node,'element');
    g.setAttribute('transform','translate('+p.x+' '+p.y+') rotate('+sideAngles[node.side]+') scale('+symbolScale(node)+')');
    g.append(S('rect',{x:-interfaceHalfWidth,y:-height/2,width:2*interfaceHalfWidth,height,rx:11,fill:'#fff',stroke:'#57776a',class:'symbol'}),S('title',{},names.interface));
    const sign = node.side === 'right' || node.side === 'bottom' ? 1 : -1;
    const dock = -sign*interfaceHalfWidth;
    g.append(S('circle',{cx:dock,cy:0,r:7,fill:'transparent',class:'dock'}),
      S('circle',{cx:dock,cy:0,r:3,fill:'#315c4a',stroke:'#315c4a',class:'symbol dock'}));
    for (const {port,direction,y} of ports) {
      const portGroup = group(port,'pick');
      const facing = direction === 'out' ? sign : -sign;
      portGroup.append(S('rect',{x:-7,y:y-9,width:14,height:18,fill:'transparent'}),
        S('polygon',{points:[[-5*facing,y-5],[5*facing,y],[-5*facing,y+5]].map(pair=>pair.join(',')).join(' '),fill:'#3f6655',stroke:'#3f6655',class:'symbol'}),
        S('title',{},direction === 'out' ? 'Outgoing Value Port' : 'Incoming Value Port'));
      g.append(portGroup);
    }
    world.append(g);
  }
  function drawStimulus(node) {
    const p = position(node);
    const g = group(node,'element');
    const size = symbolScale(node);
    const radius = stimulusRadius(node)*size;
    g.append(S('circle',{cx:p.x,cy:p.y,r:radius+4/camera.scale,fill:'transparent'}),
      S('circle',{cx:p.x,cy:p.y,r:radius,fill:node.type === 'stop' ? '#f7fbf8' : '#315c4a',stroke:'#315c4a',class:'symbol'}));
    if (node.type === 'stop') g.append(S('circle',{cx:p.x,cy:p.y,r:5*size,fill:'#315c4a','pointer-events':'none'}));
    g.append(S('title',{},names[node.type]));
    world.append(g);
  }
  function connectPosition(node) {
    const point = position(node);
    if (node.type !== 'interface') return point;
    const normal = normals[node.side];
    const distance = interfaceHalfWidth*symbolScale(node);
    return {x:point.x-normal.x*distance,y:point.y-normal.y*distance};
  }

  function drawEdge(edge) {
    const from = get(edge.from);
    const to = get(edge.to);
    const endpoint = edge.type === 'connect' ? connectPosition : position;
    const a = endpoint(from);
    const b = endpoint(to);
    const g = group(edge,'pick');
    let path = 'M '+a.x+' '+a.y+' L '+b.x+' '+b.y;
    let labelX = (a.x+b.x)/2;
    let labelY = (a.y+b.y)/2;
    if (edge.type === 'exchange') {
      const fromNormal = normals[interfaceOf(from).side];
      const toNormal = normals[interfaceOf(to).side];
      const reach = Math.max(32,Math.hypot(b.x-a.x,b.y-a.y)*.46);
      const c = {x:a.x+fromNormal.x*reach,y:a.y+fromNormal.y*reach};
      const d = {x:b.x+toNormal.x*reach,y:b.y+toNormal.y*reach};
      path = 'M '+a.x+' '+a.y+' C '+c.x+' '+c.y+' '+d.x+' '+d.y+' '+b.x+' '+b.y;
      labelX = (a.x+3*c.x+3*d.x+b.x)/8;
      labelY = (a.y+3*c.y+3*d.y+b.y)/8;
    }
    g.append(S('path',{d:path,class:'hit'}),S('path',{d:path,class:'edge'+(edge.type === 'connect'?' connect':'')}));
    if (edge.type === 'exchange' && edge.name) {
      const label = S('text',{x:labelX,y:labelY-6,'text-anchor':'middle',class:'label'},edge.name);
      label.style.pointerEvents = 'all';
      g.append(label);
    }
    g.append(S('title',{},edge.name || names[edge.type]));
    world.append(g);
  }

  function cameraView() {
    world.setAttribute('transform','translate('+camera.x+' '+camera.y+') scale('+camera.scale+')');
    grid.setAttribute('patternTransform','translate('+camera.x+' '+camera.y+') scale('+camera.scale+')');
    zoom.textContent = Math.round(camera.scale*100)+'%';
  }
  function updateSelection() {
    for (const element of world.querySelectorAll('[data-id]')) {
      element.classList.toggle('active',element.dataset.id === view.selected);
      element.classList.toggle('source',element.dataset.id === view.source);
    }
  }

  function draw() {
    world.replaceChildren();
    const boxes = model.nodes.filter(isBox);
    const layer = {composite:0,actor:1,market:1,activity:2};
    const depth = node => node.parent ? 1+depth(get(node.parent)) : 0;
    boxes.sort((a,b) => layer[a.type]-layer[b.type] || depth(a)-depth(b));
    boxes.forEach(drawBox);
    for (const edge of model.edges) drawEdge(edge);
    for (const node of model.nodes) {
      if (node.type === 'interface') drawInterface(node);
      if (isStimulus(node)) drawStimulus(node);
    }
    cameraView();
    empty.hidden = model.nodes.length > 0 || view.mode !== 'select';
    const actors = model.nodes.filter(isActor).length;
    const exchanges = model.edges.filter(edge => edge.type === 'exchange').length;
    counts.textContent = actors+' '+(actors === 1 ? 'actor' : 'actors')+' · '+exchanges+' '+(exchanges === 1 ? 'exchange' : 'exchanges');
  }
  function fit() {
    const points = model.nodes.filter(node => isBox(node) || isStimulus(node)).map(node => ({...position(node),w:node.w||10,h:node.h||25}));
    if (!points.length) {
      camera = {x:0,y:0,scale:1};
    } else {
      const x1 = Math.min(...points.map(p => p.x))-29;
      const y1 = Math.min(...points.map(p => p.y))-29;
      const x2 = Math.max(...points.map(p => p.x+p.w))+29;
      const y2 = Math.max(...points.map(p => p.y+p.h))+29;
      const bounds = diagram.getBoundingClientRect();
      const scale = clamp(Math.min((bounds.width-20)/(x2-x1),(bounds.height-20)/(y2-y1)),.1,1.15);
      camera = {x:(bounds.width-(x2+x1)*scale)/2,y:(bounds.height-(y2+y1)*scale)/2,scale};
    }
    cameraView();
  }
  function zoomBy(factor,x = diagram.clientWidth/2,y = diagram.clientHeight/2) {
    const old = camera.scale;
    camera.scale = clamp(old*factor,.1,3);
    camera.x = x-(x-camera.x)*camera.scale/old;
    camera.y = y-(y-camera.y)*camera.scale/old;
    cameraView();
  }


  return { get camera() { return camera; }, cameraView, draw, updateSelection, fit, zoomBy };
}

export { createDiagram, position, portLayout, interfaceHeight, stimulusRadius, symbolScale, horizontal, clamp };
