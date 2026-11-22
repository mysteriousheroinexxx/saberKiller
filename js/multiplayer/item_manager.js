/**
 * World Item Manager — Data-Driven Item Placement & Prop Management for Survival Mode
 * Handles loading, caching, shadow configuration, surface snapping, and telemetry.
 */

export class WorldItemManager {
  constructor(scene) {
    this.scene = scene;
    this.container = new THREE.Group();
    this.container.name = 'WorldItemsContainer';
    if (this.scene) {
      this.scene.add(this.container);
    }

    this.loader = new THREE.GLTFLoader();
    this.templates = new Map(); // url -> THREE.Group
    this.catalog = {};
    this.items = []; // list of instantiated item objects
    this.isLoaded = false;
  }

  /**
   * Preloads a single GLB template model and prepares shadow casting/receiving
   */
  async preloadTemplate(url) {
    if (this.templates.has(url)) {
      return this.templates.get(url);
    }

    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const root = gltf.scene;
          root.traverse((node) => {
            if (node.isMesh) {
              node.castShadow = true;
              node.receiveShadow = true;

              if (node.material) {
                // Ensure material handles light correctly under Configuration D
                if (Array.isArray(node.material)) {
                  node.material.forEach((mat) => {
                    mat.needsUpdate = true;
                  });
                } else {
                  node.material.needsUpdate = true;
                }
              }
            }
          });
          this.templates.set(url, root);
          resolve(root);
        },
        undefined,
        (err) => {
          console.error(`[WorldItemManager] Failed to load model template: ${url}`, err);
          reject(err);
        }
      );
    });
  }

  /**
   * Loads world items definition JSON and spawns all catalogued props and items
   */
  async loadWorldItems(manifestUrl = 'assets/data/world_items.json') {
    try {
      console.log(`[WorldItemManager] Fetching placement manifest from: ${manifestUrl}`);
      const res = await fetch(manifestUrl);
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status} while fetching ${manifestUrl}`);
      }
      const data = await res.json();
      this.catalog = data.catalog || {};
      const placements = data.placements || [];

      // 1. Preload all unique model URLs
      const uniqueUrls = new Set();
      for (const key of Object.keys(this.catalog)) {
        if (this.catalog[key].modelUrl) {
          uniqueUrls.add(this.catalog[key].modelUrl);
        }
      }

      console.log(`[WorldItemManager] Preloading ${uniqueUrls.size} unique model templates...`);
      for (const url of uniqueUrls) {
        await this.preloadTemplate(url);
      }

      // 2. Clear existing instances if re-loading
      this.clear();

      // 3. Instantiate placements
      for (const p of placements) {
        const def = this.catalog[p.type];
        if (!def) {
          console.warn(`[WorldItemManager] Unknown item type '${p.type}' for placement '${p.id}'`);
          continue;
        }

        const template = this.templates.get(def.modelUrl);
        if (!template) {
          console.warn(`[WorldItemManager] Template for '${def.modelUrl}' not found`);
          continue;
        }

        // Clone model hierarchy
        const instance = template.clone(true);
        instance.name = p.id;

        // Apply scale
        if (def.scale) {
          instance.scale.set(def.scale[0], def.scale[1], def.scale[2]);
        }

        // Apply position
        const pos = p.position || [0, 0, 0];
        instance.position.set(pos[0], pos[1], pos[2]);

        // Apply rotation
        if (p.rotation) {
          instance.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
        }

        // Tag user data for interaction & auditing
        instance.userData = {
          id: p.id,
          type: p.type,
          name: def.name,
          category: def.category,
          surfaceType: p.surfaceType,
          surfaceName: p.surfaceName || p.surfaceType,
          shelfTier: p.shelfTier || null,
          definition: def
        };

        // Attach to container
        this.container.add(instance);

        this.items.push({
          id: p.id,
          type: p.type,
          name: def.name,
          category: def.category,
          surfaceType: p.surfaceType,
          surfaceName: p.surfaceName || p.surfaceType,
          shelfTier: p.shelfTier || null,
          object: instance
        });
      }

      this.isLoaded = true;
      console.log(`[WorldItemManager] Successfully spawned ${this.items.length} items & props in Level 0`);
      return this.items;
    } catch (err) {
      console.error('[WorldItemManager] Error during item placement:', err);
      throw err;
    }
  }

  /**
   * Returns placement telemetry: world coordinates, bounding boxes, and vertical contacts
   */
  getPlacementTelemetry() {
    this.container.updateMatrixWorld(true);
    const telemetry = [];

    for (const item of this.items) {
      const obj = item.object;
      obj.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);

      telemetry.push({
        id: item.id,
        type: item.type,
        name: item.name,
        category: item.category,
        surfaceType: item.surfaceType,
        surfaceName: item.surfaceName,
        shelfTier: item.shelfTier,
        position: {
          x: +obj.position.x.toFixed(4),
          y: +obj.position.y.toFixed(4),
          z: +obj.position.z.toFixed(4)
        },
        boundingBox: {
          min: {
            x: +box.min.x.toFixed(4),
            y: +box.min.y.toFixed(4),
            z: +box.min.z.toFixed(4)
          },
          max: {
            x: +box.max.x.toFixed(4),
            y: +box.max.y.toFixed(4),
            z: +box.max.z.toFixed(4)
          },
          size: {
            x: +size.x.toFixed(4),
            y: +size.y.toFixed(4),
            z: +size.z.toFixed(4)
          }
        },
        bottomY: +box.min.y.toFixed(4),
        topY: +box.max.y.toFixed(4)
      });
    }

    return telemetry;
  }

  /**
   * Retrieves an item instance by ID
   */
  getItemById(id) {
    return this.items.find(i => i.id === id) || null;
  }

  /**
   * Cleans up placed objects from the scene
   */
  clear() {
    while (this.container.children.length > 0) {
      const child = this.container.children[0];
      this.container.remove(child);
      child.traverse((node) => {
        if (node.isMesh) {
          if (node.geometry) node.geometry.dispose();
          if (node.material) {
            if (Array.isArray(node.material)) {
              node.material.forEach(m => m.dispose());
            } else {
              node.material.dispose();
            }
          }
        }
      });
    }
    this.items = [];
    this.isLoaded = false;
  }
}
