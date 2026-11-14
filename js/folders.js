// Local playlist organization. Folder membership never changes the source playlist.
export function normalizeFolders(value) {
  const folders=[],ids=new Set(),assigned=new Set();
  for(const folder of Array.isArray(value)?value.slice(0,500):[]){
    if(!folder||!/^folder[\w-]{1,100}$/.test(folder.id)||ids.has(folder.id)||typeof folder.name!=='string'||!folder.name.trim())continue;
    ids.add(folder.id);
    const items=[];
    for(const id of Array.isArray(folder.items)?folder.items.slice(0,10000):[]){
      if(typeof id!=='string'||!id||id.length>200||id.startsWith('folder')||assigned.has(id))continue;
      assigned.add(id);items.push(id);
    }
    folders.push({id:folder.id,name:folder.name.trim().slice(0,100),items,created:Number.isFinite(folder.created)?folder.created:0});
  }
  return folders;
}

export function mergeFolders(current,incoming){
  const folders=normalizeFolders(current),extra=normalizeFolders(incoming);
  const assigned=new Set(folders.flatMap(f=>f.items));
  for(const folder of extra){
    let target=folders.find(f=>f.id===folder.id);
    if(!target){target={...folder,items:[]};folders.push(target);}
    for(const id of folder.items)if(!assigned.has(id)){target.items.push(id);assigned.add(id);}
  }
  return normalizeFolders(folders);
}
