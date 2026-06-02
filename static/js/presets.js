/* AuraWave Style & Asset Presets */

const PRESETS = {
    // Premium dynamic background gradients
    gradients: [
        {
            id: 'synthwave',
            name: 'Synthwave Glow',
            css: 'linear-gradient(135deg, #1e1b4b 0%, #311042 50%, #4c0519 100%)',
            colors: ['#1e1b4b', '#311042', '#4c0519'],
            waveColor: '#a855f7' // purple-500 default
        },
        {
            id: 'midnight',
            name: 'Midnight Aura',
            css: 'linear-gradient(135deg, #020617 0%, #0f172a 40%, #042f2e 100%)',
            colors: ['#020617', '#0f172a', '#042f2e'],
            waveColor: '#06b6d4' // cyan-500 default
        },
        {
            id: 'sunrise',
            name: 'Sunrise Lofi',
            css: 'linear-gradient(135deg, #0c0a09 0%, #1c1917 50%, #451a03 100%)',
            colors: ['#0c0a09', '#1c1917', '#451a03'],
            waveColor: '#f59e0b' // amber-500 default
        },
        {
            id: 'carbon',
            name: 'Toxic Cyber',
            css: 'linear-gradient(135deg, #09090b 0%, #030712 60%, #022c22 100%)',
            colors: ['#09090b', '#030712', '#022c22'],
            waveColor: '#10b981' // emerald-500 default
        }
    ],

    // Default presets for colors
    colors: [
        { name: 'Neon Indigo', hex: '#6366f1' },
        { name: 'Glowing Cyan', hex: '#06b6d4' },
        { name: 'Cyber Purple', hex: '#8b5cf6' },
        { name: 'Rose Petal', hex: '#f43f5e' },
        { name: 'Amber Sunset', hex: '#f59e0b' },
        { name: 'Toxic Emerald', hex: '#10b981' },
        { name: 'Rainbow Gradient', hex: 'gradient:rainbow' },
        { name: 'Synthwave Gradient', hex: 'gradient:synthwave' },
        { name: 'Sunset Gradient', hex: 'gradient:sunset' },
        { name: 'Lime Gradient', hex: 'gradient:lime' }
    ]
};

// Method to render preset backgrounds to canvas helper
function drawPresetGradient(ctx, width, height, gradientId) {
    const preset = PRESETS.gradients.find(g => g.id === gradientId) || PRESETS.gradients[0];
    
    // Create soft radial background
    const grad = ctx.createRadialGradient(
        width / 2, height / 2, 10,
        width / 2, height / 2, Math.max(width, height) * 0.8
    );
    
    // Reverse or sequence colors beautifully
    grad.addColorStop(0, preset.colors[1]); // Center glows with midtone
    grad.addColorStop(0.5, preset.colors[2]); // Vignette fades to dark
    grad.addColorStop(1, preset.colors[0]); // Base dark
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Subtle texture noise (premium analog overlay)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
    for (let i = 0; i < 40000; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        ctx.fillRect(x, y, 1, 1);
    }
}
