import * as THREE from 'three';

/** Simple hooded survivor; hidden in first person to keep the camera unobstructed. */
export class Avatar {
  readonly root = new THREE.Group();
  constructor(scene: THREE.Scene) {
    const coat = new THREE.MeshStandardMaterial({color: 0x3c4240, roughness: .95});
    const skin = new THREE.MeshStandardMaterial({color: 0xb1a28d, roughness: 1});
    const dark = new THREE.MeshStandardMaterial({color: 0x222523, roughness: 1});
    const box = (size: [number,number,number], pos: [number,number,number], mat: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat); mesh.position.set(...pos); this.root.add(mesh);
    };
    box([.54,.7,.32],[0,1.05,0],coat); box([.42,.42,.4],[0,1.63,0],dark);
    box([.27,.18,.025],[0,1.59,-.21],skin);
    for (const x of [-.19,.19]) box([.19,.69,.22],[x,.35,0],dark);
    for (const x of [-.36,.36]) box([.16,.6,.2],[x,1.05,0],coat);
    this.root.visible=false; scene.add(this.root);
  }
  update(position: THREE.Vector3,yaw: number,visible: boolean): void {
    this.root.position.copy(position); this.root.rotation.y=yaw; this.root.visible=visible;
  }
}
