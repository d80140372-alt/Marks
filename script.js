    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
    import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
    import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
    import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

    // --- CONFIG ---
    const DEFAULTS = {
        stopMotion: false, // New Checkbox
        cameraSpeed: 0.3,
        
        gridX: 600,
        gridY: 300,
        shellColor: '#3388ff',
        pulseSpeed: 4.89,
        gridGap: 0.23,
        gridOpacity: 1.0,

        plasmaColor: '#38cdff',
        bloomStrength: 0.5, 
        lineThickness: 0.005,
        speedMult: 1.0,
        lengthMult: 0.47,
        inverseTrails: false
    };

    // --- SCENE ---
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.12);

    const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.01, 100);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.NoToneMapping; 
    document.body.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // Default Flight Mode Settings
    controls.enablePan = false; 
    controls.enableZoom = false; 

    const tokamakGroup = new THREE.Group();
    scene.add(tokamakGroup);


    // --- LIGHTING ---
    const ambientLight = new THREE.AmbientLight(0x000000); 
    scene.add(ambientLight); 


    // --- POST PROCESSING ---
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.1;
    bloomPass.strength = DEFAULTS.bloomStrength;
    bloomPass.radius = 0.6;

    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);


    // --- 1. GRID SHELL ---
    const vertexShaderShell = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    const fragmentShaderShell = `
        uniform float uTime;
        uniform vec2 uGridSize;
        uniform vec3 uColor;
        uniform float uPulseSpeed;
        uniform float uGap;     
        uniform float uOpacity; 

        varying vec2 vUv;

        float random(vec2 st) {
            return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }

        void main() {
            vec2 gridUV = vUv * uGridSize;
            vec2 cellID = floor(gridUV);
            vec2 cellUV = fract(gridUV);

            float padding = uGap; 
            float square = step(padding, cellUV.x) * step(padding, cellUV.y) * 
                           step(cellUV.x, 1.0 - padding) * step(cellUV.y, 1.0 - padding);

            float rnd = random(cellID);
            float pulse = 0.5 + 0.5 * sin(uTime * uPulseSpeed + rnd * 6.28); 
            
            float alpha = square * (0.05 + 0.95 * pulse) * uOpacity;

            gl_FragColor = vec4(uColor, alpha);
        }
    `;

    const shellGeometry = new THREE.TorusGeometry(10, 3.0, 60, 200);
    const shellMaterial = new THREE.ShaderMaterial({
        vertexShader: vertexShaderShell,
        fragmentShader: fragmentShaderShell,
        uniforms: {
            uTime: { value: 0 },
            uGridSize: { value: new THREE.Vector2(DEFAULTS.gridX, DEFAULTS.gridY) },
            uColor: { value: new THREE.Color(DEFAULTS.shellColor) },
            uPulseSpeed: { value: DEFAULTS.pulseSpeed },
            uGap: { value: DEFAULTS.gridGap },
            uOpacity: { value: DEFAULTS.gridOpacity }
        },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,      
        blending: THREE.AdditiveBlending
    });

    const tokamakShell = new THREE.Mesh(shellGeometry, shellMaterial);
    tokamakGroup.add(tokamakShell);


    // --- 2. TRAIL LINES ---
    const vertexShaderTrail = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    const fragmentShaderTrail = `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uSpeed;       
        uniform float uSpeedMult;   
        uniform float uLength;      
        uniform float uLengthMult;  
        uniform float uOffset;
        uniform float uDirection; 

        varying vec2 vUv;

        void main() {
            float finalSpeed = uSpeed * uSpeedMult;
            float progress = fract(vUv.x * 2.0 - (uTime * finalSpeed * uDirection) + uOffset);
            
            float finalLength = clamp(uLength * uLengthMult, 0.01, 0.99);
            float alpha = 0.0;

            if (uDirection > 0.0) {
                float tailStart = 1.0 - finalLength;
                alpha = smoothstep(tailStart, 1.0, progress);
            } else {
                float tailEnd = finalLength;
                alpha = 1.0 - smoothstep(0.0, tailEnd, progress);
            }
            alpha = pow(alpha, 3.0); 
            gl_FragColor = vec4(uColor, alpha);
        }
    `;

    const trailsGroup = new THREE.Group();
    tokamakGroup.add(trailsGroup);

    const trailParams = {
        count: 80,
        thickness: DEFAULTS.lineThickness,
        speedMult: DEFAULTS.speedMult,
        lengthMult: DEFAULTS.lengthMult,
        direction: DEFAULTS.inverseTrails ? -1.0 : 1.0
    };

    const trailMeshes = [];

    function createTrails() {
        while(trailsGroup.children.length > 0){ 
            const obj = trailsGroup.children[0];
            if(obj.geometry) obj.geometry.dispose();
            trailsGroup.remove(obj); 
        }
        trailMeshes.length = 0;

        for (let i = 0; i < trailParams.count; i++) {
            const laneRadius = 7.5 + Math.random() * 5.0; 
            const geo = new THREE.TorusGeometry(laneRadius, trailParams.thickness, 6, 120);
            const mat = new THREE.ShaderMaterial({
                vertexShader: vertexShaderTrail,
                fragmentShader: fragmentShaderTrail,
                uniforms: {
                    uTime: { value: 0 },
                    uColor: { value: new THREE.Color(DEFAULTS.plasmaColor) },
                    uSpeed: { value: 0.1 + Math.random() * 0.3 }, 
                    uSpeedMult: { value: trailParams.speedMult }, 
                    uLength: { value: 0.1 + Math.random() * 0.2 }, 
                    uLengthMult: { value: trailParams.lengthMult },
                    uOffset: { value: Math.random() * 100.0 },
                    uDirection: { value: trailParams.direction }
                },
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = (Math.random() - 0.5) * 0.1;
            mesh.position.z = (Math.random() - 0.5) * 0.5;
            trailsGroup.add(mesh);
            trailMeshes.push(mat);
        }
    }

    createTrails();


    // --- GUI ---
    const gui = new GUI({ title: 'Tokamak Control', width: 300 });
    gui.close();

    const params = { ...DEFAULTS };

    const camFolder = gui.addFolder('Camera / Flight');
    camFolder.add(params, 'cameraSpeed', 0.0, 2.0).name('Flight Speed');
    // 1. New Checkbox Logic
    camFolder.add(params, 'stopMotion').name('Stop Motion Camera').onChange(v => {
        if(v) {
            // STOPPED: Enable manual control
            controls.enablePan = true;
            controls.enableZoom = true;
            controls.autoRotate = false;
        } else {
            // FLIGHT: Disable manual interference, sync angle
            controls.enablePan = false;
            controls.enableZoom = false;
            // Sync flight angle to current camera position to prevent jumping
            cameraAngle = Math.atan2(camera.position.y, camera.position.x);
        }
    });

    const shellFolder = gui.addFolder('Grid Settings');
    shellFolder.add(params, 'gridX', 0, 2000).onChange(v => shellMaterial.uniforms.uGridSize.value.x = v);
    shellFolder.add(params, 'gridY', 0, 1000).onChange(v => shellMaterial.uniforms.uGridSize.value.y = v);
    shellFolder.addColor(params, 'shellColor').onChange(v => shellMaterial.uniforms.uColor.value.set(v));
    shellFolder.add(params, 'pulseSpeed', 0, 10).onChange(v => shellMaterial.uniforms.uPulseSpeed.value = v);
    shellFolder.add(params, 'gridGap', 0.0, 0.45).onChange(v => shellMaterial.uniforms.uGap.value = v);
    shellFolder.add(params, 'gridOpacity', 0.0, 1.0).onChange(v => shellMaterial.uniforms.uOpacity.value = v);
    
    const plasmaFolder = gui.addFolder('Plasma / Trails');
    plasmaFolder.addColor(params, 'plasmaColor').onChange(v => {
        trailMeshes.forEach(mat => mat.uniforms.uColor.value.set(v));
    });
    plasmaFolder.add(params, 'bloomStrength', 0, 3).onChange(v => bloomPass.strength = v);
    plasmaFolder.add(params, 'lineThickness', 0.001, 0.1).onChange(v => {
        trailParams.thickness = v;
        createTrails(); 
    });
    plasmaFolder.add(params, 'speedMult', 0.0, 5.0).onChange(v => {
        trailParams.speedMult = v;
        trailMeshes.forEach(m => m.uniforms.uSpeedMult.value = v);
    });
    plasmaFolder.add(params, 'lengthMult', 0.1, 5.0).onChange(v => {
        trailParams.lengthMult = v;
        trailMeshes.forEach(m => m.uniforms.uLengthMult.value = v);
    });
    plasmaFolder.add(params, 'inverseTrails').name('Inverse Motion').onChange(v => {
        trailParams.direction = v ? -1.0 : 1.0;
        trailMeshes.forEach(m => m.uniforms.uDirection.value = trailParams.direction);
    });

    // --- ANIMATION LOOP ---
    const clock = new THREE.Clock();
    let cameraAngle = 0; 

    function animate() {
        requestAnimationFrame(animate);
        const delta = clock.getDelta();
        const elapsedTime = clock.getElapsedTime();

        // 2. Conditional Flight Logic
        if (!params.stopMotion) {
            cameraAngle += params.cameraSpeed * delta;
            
            const r = 10; 
            const camX = Math.cos(cameraAngle) * r;
            const camY = Math.sin(cameraAngle) * r;
            
            camera.position.set(camX, camY, 0.5);

            const lookAtAngle = cameraAngle + 0.1;
            const targetX = Math.cos(lookAtAngle) * r;
            const targetY = Math.sin(lookAtAngle) * r;
            
            controls.target.set(targetX, targetY, 0);
        }
        
        // Always update controls (for damping in both modes)
        controls.update();

        shellMaterial.uniforms.uTime.value = elapsedTime;
        trailMeshes.forEach(mat => {
            mat.uniforms.uTime.value = elapsedTime;
        });

        composer.render();
    }

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();