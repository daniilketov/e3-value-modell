const storageKey = 'e3-value-model-v1';
const names = {
  actor:'Actor', market:'Market Segment', composite:'Composite Actor', activity:'Value Activity',
  interface:'Value Interface', offering:'Value Offering', port:'Value Port', exchange:'Value Exchange', relay:'Port Connection',
  start:'Start Stimulus', stop:'Stop Stimulus', connect:'Connect Element'
};
const isActor = node => ['actor','market','composite'].includes(node?.type);
const isBox = node => isActor(node) || node?.type === 'activity';
const sides = ['left','right','top','bottom'];
const isStimulus = node => ['start','stop'].includes(node?.type);
const get = id => model.nodes.find(node => node.id === id);
const edgeById = id => model.edges.find(edge => edge.id === id);
const children = id => model.nodes.filter(node => node.parent === id);
const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const blank = () => ({version:1,title:'Untitled model',nodes:[],edges:[]});
const sample = () => ({
  version:1,title:'Bread for money',
  nodes:[
    {id:'bakery',type:'actor',name:'Bakery',x:90,y:150,w:240,h:245,parent:null},
    {id:'customers',type:'market',name:'Customers',x:575,y:150,w:240,h:245,parent:null},
    {id:'bake',type:'activity',name:'Bake bread',x:32,y:69,w:135,h:145,parent:'bakery'},
    {id:'seller',type:'interface',parent:'bakery',side:'right',offset:.51},
    {id:'buyer',type:'interface',parent:'customers',side:'left',offset:.51},
    {id:'bo',type:'offering',parent:'seller',direction:'out'}, {id:'bi',type:'offering',parent:'seller',direction:'in'},
    {id:'ci',type:'offering',parent:'buyer',direction:'in'}, {id:'co',type:'offering',parent:'buyer',direction:'out'},
    {id:'bread-out',type:'port',parent:'bo'}, {id:'bread-in',type:'port',parent:'ci'},
    {id:'money-out',type:'port',parent:'co'}, {id:'money-in',type:'port',parent:'bi'},
    {id:'buy',type:'activity',name:'Buy bread',x:36,y:69,w:158,h:145,parent:'customers'},
    {id:'buy-path',type:'interface',parent:'buy',side:'left',offset:.57},
    {id:'bake-path',type:'interface',parent:'bake',side:'right',offset:.43},
    {id:'need',type:'start',x:88,y:56,parent:'buy'},
    {id:'done',type:'stop',x:54,y:56,parent:'bake'}
  ],
  edges:[
    {id:'bread',type:'exchange',from:'bread-out',to:'bread-in',name:'Bread'},
    {id:'money',type:'exchange',from:'money-out',to:'money-in',name:'Money'},
    {id:'start-path',type:'connect',from:'need',to:'buy-path'},
    {id:'buy-connection',type:'connect',from:'buy-path',to:'buyer'},
    {id:'bake-connection',type:'connect',from:'seller',to:'bake-path'},
    {id:'stop-path',type:'connect',from:'bake-path',to:'done'}
  ]
});

let model = validate(sample());

function loadModel() {
  const saved = localStorage.getItem(storageKey);
  if (saved) model = validate(JSON.parse(saved));
}

function setModel(next) {
  model = next;
}

function storeModel() {
  localStorage.setItem(storageKey,JSON.stringify(model));
}

function portsFor(iface,direction) {
  const offering = children(iface.id).find(node => node.type === 'offering' && node.direction === direction);
  return offering ? children(offering.id) : [];
}

function addInterfacePort(nodes,iface,direction,nextId = uid) {
  let offering = nodes.find(node => node.type === 'offering' && node.parent === iface.id && node.direction === direction);
  if (!offering) {
    offering = {id:nextId(),type:'offering',parent:iface.id,direction};
    nodes.push(offering);
  }
  nodes.push({id:nextId(),type:'port',parent:offering.id});
}

function validate(data) {
  if (data?.version !== 1 || typeof data.title !== 'string' || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw Error('Choose an e³-value model JSON file.');
  }
  const nodes = new Map();
  const ids = new Set();
  for (const item of [...data.nodes,...data.edges]) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw Error('The model has invalid element IDs.');
    ids.add(item.id);
  }
  for (const node of data.nodes) {
    if (!['actor','market','composite','activity','interface','offering','port','start','stop'].includes(node.type)) throw Error('Unknown model element.');
    if ((isBox(node) || isStimulus(node)) && ![node.x,node.y].every(Number.isFinite)) throw Error('Invalid element position.');
    if (isBox(node) && (![node.w,node.h].every(Number.isFinite) || node.w < 100 || node.h < 75)) throw Error('Invalid element size.');
    if (node.type === 'interface' && (!sides.includes(node.side) || !Number.isFinite(node.offset) || node.offset < 0 || node.offset > 1)) throw Error('Invalid Value Interface.');
    if ((isStimulus(node) || node.type === 'interface') && node.size !== undefined
        && (!Number.isFinite(node.size) || node.size < .5 || node.size > 4)) throw Error('Invalid symbol size.');
    if (node.type === 'offering' && !['in','out'].includes(node.direction)) throw Error('Invalid Value Offering direction.');
    if (node.name !== undefined && typeof node.name !== 'string') throw Error('Invalid element name.');
    nodes.set(node.id,node);
  }
  const offeringKeys = new Set();
  for (const node of data.nodes) {
    const parent = nodes.get(node.parent);
    // Older models could contain stimuli directly on actors or the canvas.
    const legacyStimulus = isStimulus(node) && (!parent || isBox(parent));
    if ((node.parent != null && !parent) || (!legacyStimulus && !allowedParent(node.type,parent))) throw Error('An element has an invalid parent.');
    if (node.type === 'offering') {
      const key = JSON.stringify([node.parent,node.direction]);
      if (offeringKeys.has(key)) throw Error('A Value Interface has duplicate offerings in one direction.');
      offeringKeys.add(key);
    }
    const visited = new Set([node.id]);
    for (let ancestor = parent; ancestor; ancestor = nodes.get(ancestor.parent)) {
      if (visited.has(ancestor.id)) throw Error('The model contains a circular parent reference.');
      visited.add(ancestor.id);
    }
  }
  const lookup = id => nodes.get(id);
  const links = new Set();
  for (const edge of data.edges) {
    const from = lookup(edge.from);
    const to = lookup(edge.to);
    const endpoints = JSON.stringify([edge.type,...[edge.from,edge.to].sort()]);
    if (links.has(endpoints) || (edge.type === 'exchange' && typeof edge.name !== 'string')
        || !validLink(edge.type,from,to,lookup,{allowLegacyStimulusLinks:true})) throw Error('The model has an invalid connection.');
    links.add(endpoints);
  }
  // Repair interfaces saved before the minimum port rule without changing their existing links.
  const parentsWithPorts = new Set(data.nodes.filter(node => node.type === 'port').map(node => node.parent));
  const populatedDirections = new Set(data.nodes.filter(node => node.type === 'offering' && parentsWithPorts.has(node.id))
    .map(node => JSON.stringify([node.parent,node.direction])));
  function nextId() {
    let id;
    do { id = uid(); } while (ids.has(id));
    ids.add(id);
    return id;
  }
  for (const node of nodes.values()) {
    if (node.type === 'interface' || isStimulus(node)) delete node.name;
    if (node.type !== 'interface') continue;
    for (const direction of ['in','out']) {
      if (!populatedDirections.has(JSON.stringify([node.id,direction]))) addInterfacePort(data.nodes,node,direction,nextId);
    }
  }
  return data;
}

function allowedParent(type,parent) {
  if (['actor','market','composite'].includes(type)) return !parent || parent.type === 'composite';
  if (type === 'activity') return isActor(parent);
  if (type === 'interface') return isBox(parent);
  if (type === 'offering') return parent?.type === 'interface';
  if (type === 'port') return parent?.type === 'offering';
  return isStimulus({type}) && parent?.type === 'activity';
}

function activityHasStimulus(activity) {
  return children(activity.id).some(isStimulus);
}

function interfaceOf(node, lookup = get) {
  return node?.type === 'port' ? lookup(lookup(node.parent)?.parent) : node;
}
function isActivityActorPair(first,second,lookup = get) {
  if (first?.type !== 'port' || second?.type !== 'port') return false;
  const fromOwner = lookup(interfaceOf(first,lookup)?.parent);
  const toOwner = lookup(interfaceOf(second,lookup)?.parent);
  return (fromOwner?.type === 'activity' && isActor(toOwner) && fromOwner.parent === toOwner.id)
    || (toOwner?.type === 'activity' && isActor(fromOwner) && toOwner.parent === fromOwner.id);
}

function validLink(type,from,to,lookup = get,{allowLegacyStimulusLinks = false} = {}) {
  if (!from || !to || from.id === to.id) return false;
  if (type === 'relay') {
    return isActivityActorPair(from,to,lookup)
      && lookup(from.parent)?.direction === lookup(to.parent)?.direction;
  }
  if (type === 'exchange') {
    return from.type === 'port' && to.type === 'port'
      && lookup(from.parent)?.direction === 'out' && lookup(to.parent)?.direction === 'in'
      && interfaceOf(from,lookup)?.id !== interfaceOf(to,lookup)?.id;
  }
  if (type !== 'connect') return false;
  if (from.type === 'interface' && to.type === 'interface') return true;
  const stimulus = isStimulus(from) ? from : to;
  const iface = stimulus === from ? to : from;
  if (!isStimulus(stimulus) || iface.type !== 'interface') return false;
  // Existing files can contain links created before the same-activity rule.
  return allowLegacyStimulusLinks
    || (lookup(stimulus.parent)?.type === 'activity' && stimulus.parent === iface.parent);
}


export { names, isActor, isBox, isStimulus, sides, model, get, edgeById, children, uid, blank, portsFor, addInterfacePort, validate, allowedParent, activityHasStimulus, interfaceOf, isActivityActorPair, validLink, loadModel, setModel, storeModel };
