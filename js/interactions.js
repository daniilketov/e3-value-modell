import { names, model, isBox, isStimulus, sides, get, children, uid, allowedParent, interfaceOf, validLink } from './model.js';
import { position, portLayout, interfaceHeight, stimulusRadius, symbolScale, horizontal, clamp } from './diagram.js';

const snap = n => Math.round(n / 10) * 10;
const instructions = {
  select:'Drag the middle to move or an edge to resize.',
  pan:'Drag the canvas to pan.',
  actor:'Click the canvas or inside a Composite Actor.',
  market:'Click the canvas or inside a Composite Actor.',
  composite:'Click the canvas or inside a Composite Actor.',
  activity:'Click inside the Actor, Market Segment, or Composite Actor that performs this activity.',
  interface:'Click near any side of a participant or Value Activity.',
  offering:'Click a Value Interface, then choose the direction.',
  port:'Click a Value Interface, then choose the offering direction.',
  start:'Click inside the Value Activity where the scenario starts.',
  stop:'Click inside the Value Activity where the scenario ends.',
  exchange:'Click the outgoing Value Port.',
  connect:'Click a Stimulus or Value Interface.'
};

function bindInteractions(diagram, stage, canvas, view, { change, record, notice, render, select }) {
  let drag = null;
  let ignoreClick = false;

  function pointAt(event) {
    const rect = diagram.getBoundingClientRect();
    return {x:(event.clientX-rect.left-canvas.camera.x)/canvas.camera.scale,y:(event.clientY-rect.top-canvas.camera.y)/canvas.camera.scale};
  }
  function targetId(event) {
    return event.target.closest('[data-id]')?.dataset.id;
  }
  function boxAt(point,predicate) {
    return model.nodes.filter(node => isBox(node) && predicate(node)).filter(node => {
      const p = position(node);
      return point.x >= p.x && point.y >= p.y && point.x <= p.x+node.w && point.y <= p.y+node.h;
    }).sort((a,b) => a.w*a.h-b.w*b.h)[0];
  }
  function interfaceAnchor(parent,point) {
    const origin = position(parent);
    const x = point.x-origin.x;
    const y = point.y-origin.y;
    const distances = [Math.abs(x),Math.abs(parent.w-x),Math.abs(y),Math.abs(parent.h-y)];
    const side = sides[distances.indexOf(Math.min(...distances))];
    const offset = horizontal(side) ? x/parent.w : y/parent.h;
    return {side,offset:clamp(offset,.08,.92)};
  }
  function placeStimulus(node,parent,x,y) {
    const radius = stimulusRadius(node)*symbolScale(node);
    node.x = parent ? clamp(x,radius,parent.w-radius) : x;
    node.y = parent ? clamp(y,radius,parent.h-radius) : y;
  }
  function resizeEdges(node,point) {
    if (!isBox(node)) return null;
    const origin = position(node);
    const x = point.x-origin.x;
    const y = point.y-origin.y;
    const margin = 8/canvas.camera.scale;
    return {
      x:Math.abs(x) <= margin ? -1 : Math.abs(x-node.w) <= margin ? 1 : 0,
      y:Math.abs(y) <= margin ? -1 : Math.abs(y-node.h) <= margin ? 1 : 0
    };
  }
  function dragAction(node,point) {
    const edges = resizeEdges(node,point);
    if (edges?.x || edges?.y) {
      const cursor = edges.x && edges.y ? (edges.x === edges.y ? 'nwse-resize' : 'nesw-resize')
        : edges.x ? 'ew-resize' : 'ns-resize';
      return {edges,cursor};
    }
    if (isStimulus(node) || node?.type === 'interface') {
      const center = position(node);
      const margin = 5/canvas.camera.scale;
      const size = symbolScale(node);
      const x = Math.abs(point.x-center.x);
      const y = Math.abs(point.y-center.y);
      let rim;
      if (isStimulus(node)) {
        const radius = stimulusRadius(node)*size;
        rim = Math.hypot(x,y) >= Math.max(radius*.5,radius-margin);
      } else {
        const length = interfaceHeight(portLayout(node).length)*size/2;
        const thickness = 12*size;
        rim = horizontal(node.side) ? x >= length-margin || y >= thickness-margin
          : y >= length-margin || x >= thickness-margin;
      }
      if (rim) return {scale:true,cursor:'nwse-resize',center};
    }
    return {cursor:node ? 'move' : ''};
  }
  function resizeBox(drag,dx,dy,parent) {
    const {node,edges,baseX,baseY,baseW,baseH} = drag;
    const items = children(node.id).filter(child => isBox(child) || isStimulus(child));
    const childBounds = (child,axis) => {
      const size = isBox(child) ? (axis === 'x' ? child.w : child.h) : stimulusRadius(child)*symbolScale(child);
      return child[axis]+size;
    };
    const minW = Math.min(baseW,Math.max(100,...items.map(child => childBounds(child,'x')+8)));
    const minH = Math.min(baseH,Math.max(75,...items.map(child => childBounds(child,'y')+8)));
    if (edges.x) {
      const maxW = parent ? edges.x < 0 ? baseX+baseW-8 : parent.w-baseX-8 : Infinity;
      node.w = clamp(baseW+edges.x*dx,minW,Math.max(baseW,maxW));
      if (edges.x < 0) node.x = baseX+baseW-node.w;
    }
    if (edges.y) {
      const maxH = parent ? edges.y < 0 ? baseY+baseH-8 : parent.h-baseY-8 : Infinity;
      node.h = clamp(baseH+edges.y*dy,minH,Math.max(baseH,maxH));
      if (edges.y < 0) node.y = baseY+baseH-node.h;
    }
  }
  function createAt(type,point,target) {
    const node = {id:uid(),type,name:isStimulus({type}) ? '' : names[type],parent:null};
    const clickedBox = isBox(target) ? target : null;
    let parent;
    if (type === 'activity') parent = clickedBox?.type === 'activity' ? get(clickedBox.parent) : clickedBox;
    else if (type === 'interface') parent = clickedBox || boxAt(point,() => true);
    else if (isStimulus(node)) parent = boxAt(point,box => box.type === 'activity');
    else parent = boxAt(point,box => box.type === 'composite');

    if (!allowedParent(type,parent)) {
      notice(instructions[type],true);
      return;
    }
    node.parent = parent?.id || null;
    const origin = parent ? position(parent) : {x:0,y:0};
    const x = point.x-origin.x;
    const y = point.y-origin.y;
    if (type === 'interface') {
      Object.assign(node,interfaceAnchor(parent,point));
    } else if (isStimulus(node)) {
      placeStimulus(node,parent,x,y);
    } else {
      node.w = {activity:125,composite:500,actor:210,market:210}[type];
      node.h = {activity:90,composite:360,actor:200,market:200}[type];
      if (parent && (node.w+16 > parent.w || node.h+54 > parent.h)) {
        notice('Increase the size of the parent to fit this element.',true);
        return;
      }
      node.x = parent ? clamp(snap(x),8,parent.w-node.w-8) : snap(x);
      node.y = parent ? clamp(snap(y),46,parent.h-node.h-8) : snap(y);
    }
    change(() => {
      model.nodes.push(node);
      view.selected = node.id;
      view.mode = 'select';
      notice(instructions.select);
    });
  }
  function linkTo(target) {
    if (!view.source) {
      const acceptable = view.mode === 'exchange'
        ? target?.type === 'port' && get(target.parent)?.direction === 'out'
        : target?.type === 'interface' || isStimulus(target);
      if (!acceptable) {
        notice(instructions[view.mode],true);
        return;
      }
      view.source = target.id;
      notice(view.mode === 'exchange' ? 'Click the incoming Value Port.' : 'Click the other Stimulus or Value Interface.');
      render();
      return;
    }
    const from = get(view.source);
    if (!validLink(view.mode,from,target)) {
      notice(view.mode === 'exchange' ? 'Choose an incoming port on a different Value Interface.'
        : 'Link a Stimulus to an interface, or link two interfaces in the same activity or between an actor and its activity.',true);
      return;
    }
    if (model.edges.some(edge => edge.type === view.mode && (
      (edge.from === view.source && edge.to === target.id)
      || (view.mode === 'connect' && edge.to === view.source && edge.from === target.id)
    ))) {
      notice('These elements are already connected.',true);
      return;
    }
    change(() => {
      const edge = {id:uid(),type:view.mode,from:view.source,to:target.id};
      if (view.mode === 'exchange') edge.name = 'Value Object';
      model.edges.push(edge);
      view.selected = edge.id;
      view.mode = 'select';
      view.source = null;
      notice(edge.type === 'exchange' ? 'Name the exchanged Value Object in Properties.' : instructions.select);
    });
  }
  diagram.addEventListener('click',event => {
    if (ignoreClick) return;
    const id = targetId(event);
    const target = get(id);
    if (view.mode === 'select') {
      select(id || null);
    } else if (view.mode === 'exchange' || view.mode === 'connect') {
      linkTo(target);
    } else if (view.mode === 'offering' || view.mode === 'port') {
      const iface = target?.type === 'offering' ? get(target.parent) : interfaceOf(target);
      if (iface?.type !== 'interface') {
        notice(instructions[view.mode],true);
        return;
      }
      view.selected = iface.id;
      notice('Choose the direction in Properties.');
      render();
    } else if (view.mode !== 'pan') {
      createAt(view.mode,pointAt(event),target);
    }
  });
  function draggableNode(event) {
    const node = get(targetId(event));
    return ['port','offering'].includes(node?.type) ? null : node;
  }
  diagram.addEventListener('pointerdown',event => {
    ignoreClick = false;
    if (event.button !== 0 && event.button !== 1) return;
    const node = draggableNode(event);
    const pan = view.mode === 'pan' || event.button === 1;
    if (!pan && (view.mode !== 'select' || !node)) return;
    const point = pointAt(event);
    const action = pan ? {cursor:'grabbing'} : dragAction(node,point);
    drag = {...action,node,pan,id:event.pointerId,x:event.clientX,y:event.clientY,point,started:false,
      baseX:pan ? canvas.camera.x : node.x,baseY:pan ? canvas.camera.y : node.y,
      baseW:node?.w,baseH:node?.h,baseSize:symbolScale(node || {}),
      before:pan ? null : JSON.stringify(model)};
  });
  diagram.addEventListener('pointermove',event => {
    if (!drag || drag.id !== event.pointerId) {
      diagram.style.cursor = view.mode === 'select' ? dragAction(draggableNode(event),pointAt(event)).cursor : '';
      return;
    }
    const dx = event.clientX-drag.x;
    const dy = event.clientY-drag.y;
    if (!drag.started) {
      if (Math.hypot(dx,dy)<4) return;
      drag.started = true;
      diagram.setPointerCapture(event.pointerId);
      stage.classList.add('dragging');
      diagram.style.cursor = drag.cursor;
      if (!drag.pan) view.selected = drag.node.id;
    }
    if (drag.pan) {
      canvas.camera.x = drag.baseX+dx;
      canvas.camera.y = drag.baseY+dy;
      canvas.cameraView();
      return;
    }
    const node = drag.node;
    const parent = get(node.parent);
    if (drag.edges?.x || drag.edges?.y) {
      resizeBox(drag,dx/canvas.camera.scale,dy/canvas.camera.scale,parent);
    } else if (drag.scale) {
      const center = drag.center;
      const point = pointAt(event);
      const initial = Math.hypot(drag.point.x-center.x,drag.point.y-center.y);
      const distance = Math.hypot(point.x-center.x,point.y-center.y);
      let max = 4;
      if (isStimulus(node) && parent) {
        max = Math.max(drag.baseSize,Math.min(node.x,node.y,parent.w-node.x,parent.h-node.y)/stimulusRadius(node));
        max = Math.min(max,4);
      }
      node.size = clamp(drag.baseSize*distance/initial,.5,max);
    } else if (node.type === 'interface') {
      const point = pointAt(event);
      Object.assign(node,interfaceAnchor(parent,point));
    } else {
      const x = snap(drag.baseX+dx/canvas.camera.scale);
      const y = snap(drag.baseY+dy/canvas.camera.scale);
      if (isStimulus(node)) {
        placeStimulus(node,parent,x,y);
      } else {
        node.x = parent ? clamp(x,8,Math.max(8,parent.w-node.w-8)) : x;
        node.y = parent ? clamp(y,35,Math.max(35,parent.h-node.h-8)) : y;
      }
    }
    canvas.draw();
  });
  function endDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.started) {
      ignoreClick = true;
      if (!drag.pan && JSON.stringify(model) !== drag.before) record(drag.before);
      stage.classList.remove('dragging');
      render();
    }
    drag = null;
  }
  diagram.addEventListener('pointerup',endDrag);
  diagram.addEventListener('pointercancel',endDrag);
  diagram.addEventListener('pointerleave',() => { if (drag && !drag.started) drag = null; });
  diagram.addEventListener('wheel',event => {
    event.preventDefault();
    const bounds = diagram.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) canvas.zoomBy(Math.exp(-event.deltaY*.009),event.clientX-bounds.left,event.clientY-bounds.top);
    else {
      canvas.camera.x -= event.deltaX;
      canvas.camera.y -= event.deltaY;
      canvas.cameraView();
    }
  },{passive:false});


  return () => Boolean(drag);
}

export { bindInteractions, instructions };
