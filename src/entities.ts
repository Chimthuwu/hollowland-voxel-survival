import * as THREE from 'three';
import { Block, type Biome, type World } from './world';

type Kind = 'stalker' | 'node' | 'crawler' | 'hallucination';
type Mob = { root: THREE.Group; kind: Kind; hp: number; speed: number; damage: number; cooldown: number; teleport: number; vy: number; fake: boolean };
const stats: Record<Kind, {hp:number;speed:number;damage:number}> = {
  stalker:{hp:30,speed:3,damage:10}, node:{hp:20,speed:3,damage:15}, crawler:{hp:25,speed:5,damage:12}, hallucination:{hp:20,speed:3.8,damage:8}
};
function kindFor(b:Biome):Kind { return b==='glitch'?'node':b==='maw'||b==='veins'?'crawler':b==='psychosis'?'hallucination':'stalker'; }

export class Enemies {
  private readonly mobs: Mob[] = [];
  private spawnTimer = 5;
  constructor(private readonly scene:THREE.Scene, private readonly world:Pick<World, 'get' | 'surface'>) {}
  spawn(biome:Biome, position:THREE.Vector3):void {
    const kind=kindFor(biome), data=stats[kind], root=new THREE.Group();
    const material=new THREE.MeshStandardMaterial({color:kind==='crawler'?0x7c202c:kind==='node'?0xe62db5:0x151316,roughness:.9,emissive:kind==='node'?0x4d073d:0x080406,wireframe:kind==='node'});
    const add=(geo:THREE.BufferGeometry,x:number,y:number,z:number)=>{const mesh=new THREE.Mesh(geo,material);mesh.position.set(x,y,z);root.add(mesh);};
    if(kind==='node') add(new THREE.IcosahedronGeometry(.65,1),0,1.0,0);
    else if(kind==='crawler') {
      add(new THREE.BoxGeometry(.9,.45,1.1),0,.4,0);add(new THREE.BoxGeometry(.5,.4,.4),0,.42,-.65);
      for(const x of [-.6,.6]) for(const z of [-.35,.35]) add(new THREE.BoxGeometry(.35,.25,.18),x,.2,z);
    } else {
      add(new THREE.BoxGeometry(.55,.75,.35),0,1.15,0);add(new THREE.BoxGeometry(.4,.42,.4),0,1.75,0);
      for(const x of [-.2,.2]) add(new THREE.BoxGeometry(.18,.75,.2),x,.4,0);
      for(const x of [-.4,.4]) add(new THREE.BoxGeometry(.15,.7,.2),x,1.1,0);
      const eyes=new THREE.MeshBasicMaterial({color:0xc74e47}); for(const x of [-.1,.1]){const eye=new THREE.Mesh(new THREE.BoxGeometry(.06,.05,.02),eyes);eye.position.set(x,1.79,-.21);root.add(eye);}
    }
    root.position.copy(position);this.scene.add(root);
    this.mobs.push({root,kind,...data,cooldown:0,teleport:2,vy:0,fake:kind==='hallucination'&&Math.random()<.45});
  }
  update(dt:number,player:THREE.Vector3,biome:Biome,onDamage:(amount:number)=>void):void {
    dt=Math.min(.05,Math.max(0,dt));this.spawnTimer-=dt;
    if(this.spawnTimer<=0){
      this.spawnTimer=biome==='overcast'?11:6;
      if(this.mobs.length<10){const a=Math.random()*Math.PI*2,r=11+Math.random()*5,x=player.x+Math.sin(a)*r,z=player.z+Math.cos(a)*r;
        const ground=player.y<0?Math.floor(player.y):this.world.surface(x,z)+1;
        if(this.world.get(x,ground,z)===Block.Air && this.world.get(x,ground+1,z)===Block.Air)this.spawn(biome,new THREE.Vector3(x,ground,z));
      }
    }
    for(let i=this.mobs.length-1;i>=0;i--){
      const mob=this.mobs[i],p=mob.root.position;mob.cooldown=Math.max(0,mob.cooldown-dt);
      const dx=player.x-p.x,dz=player.z-p.z,dist=Math.hypot(dx,dz);
      if(dist>42){this.remove(i);continue;}
      if(dist<20&&dist>.9){
        let step=mob.speed*dt;
        if(mob.kind==='node'){mob.teleport-=dt;if(mob.teleport<=0){step=Math.min(2,dist-1);mob.teleport=2+Math.random();}}
        const nx=p.x+dx/dist*step,nz=p.z+dz/dist*step;
        if(this.world.get(nx,p.y+.3,nz)!==Block.Air){
          if(this.world.get(nx,p.y+1.1,nz)===Block.Air&&this.world.get(nx,p.y+2,nz)===Block.Air&&Math.abs(mob.vy)<.01)mob.vy=6.2;
        } else {p.x=nx;p.z=nz;}
        mob.root.rotation.y=Math.atan2(-dx,-dz);
      }
      mob.vy=Math.max(-20,mob.vy-20*dt);const next=p.y+mob.vy*dt;
      if(mob.vy<=0&&this.world.get(p.x,next-.05,p.z)!==Block.Air){p.y=Math.floor(next-.05)+1;mob.vy=0;}else if(mob.vy>0&&this.world.get(p.x,next+1.7,p.z)!==Block.Air)mob.vy=0;else p.y=next;
      if(dist<1.15&&Math.abs(p.y-player.y)<1.8&&mob.cooldown<=0){if(mob.fake){this.remove(i);continue;}onDamage(mob.damage);mob.cooldown=1;}
    }
  }
  attack(origin:THREE.Vector3,direction:THREE.Vector3,range:number,damage:number):boolean {
    const dir=direction.clone().normalize();let best=-1,near=range;
    for(let i=0;i<this.mobs.length;i++){
      const mob=this.mobs[i], center=mob.root.position.clone().add(new THREE.Vector3(0,mob.kind==='crawler'?.5:1,0));
      const delta=center.sub(origin), along=delta.dot(dir);if(along<0||along>near)continue;
      if(delta.addScaledVector(dir,-along).length()>.8)continue;
      best=i;near=along;
    }
    if(best<0)return false;
    const mob=this.mobs[best];mob.hp-=damage;if(mob.hp<=0)this.remove(best);else {mob.root.position.addScaledVector(dir,.18);}
    return true;
  }
  clear():void {for(let i=this.mobs.length-1;i>=0;i--)this.remove(i);this.spawnTimer=5;}
  private remove(index:number):void {
    const mob=this.mobs[index];this.scene.remove(mob.root);
    const materials=new Set<THREE.Material>();mob.root.traverse(obj=>{if(obj instanceof THREE.Mesh){obj.geometry.dispose();if(Array.isArray(obj.material))obj.material.forEach(m=>materials.add(m));else materials.add(obj.material);}});materials.forEach(m=>m.dispose());this.mobs.splice(index,1);
  }
}
