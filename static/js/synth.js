/* AuraWave Cozy Ambient Lofi Synthesizer Engine */

// Synthesizer variables
let synthInterval = null;
let synthNodes = []; // store active synth nodes for cleanup

function toggleSynthDemo(active) {
    state.audio.synthActive = active;
    
    if (active) {
        removeAudioTrack();
        elements.synthOptions.classList.add('open');
        
        if (!state.audio.context) {
            state.audio.context = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Setup Web Audio Analyser if not present
        if (!state.audio.analyser) {
            state.audio.analyser = state.audio.context.createAnalyser();
            state.audio.analyser.fftSize = 512;
            
            state.audio.gainNode = state.audio.context.createGain();
            state.audio.gainNode.gain.setValueAtTime(state.audio.volume, state.audio.context.currentTime);
            
            state.audio.analyser.connect(state.audio.gainNode);
            state.audio.gainNode.connect(state.audio.context.destination);
        }
        
        state.audio.duration = 3600; // virtual infinite duration
        elements.timeTotal.innerText = '--:--';
        elements.trackTitle.value = "Synthetic Dreamscape";
        state.text.title = "Synthetic Dreamscape";
        
        // Spin up interactive synthesizer progression
        startSynthProgression();
        
        state.audio.isPlaying = true;
        elements.btnPlay.innerHTML = '<i class="fa-solid fa-pause"></i>';
        
        // Kick off drawing (drawLoop is defined globally in visualizer.js)
        if (!animationId) drawLoop();
    } else {
        elements.synthOptions.classList.remove('open');
        stopSynthProgression();
        stopAudio();
    }
}

// Play synthesized ambient notes using custom oscillators
function startSynthProgression() {
    if (!state.audio.synthActive) return;
    
    const context = state.audio.context;
    const analyser = state.audio.analyser;
    
    // Define simple chords (pentatonic cozy / chill)
    const chordPresets = {
        chill: [
            [130.81, 164.81, 196.00, 246.94], // Cmaj7
            [110.00, 138.59, 164.81, 220.00], // A7
            [174.61, 220.00, 261.63, 329.63], // Fmaj7
            [196.00, 246.94, 293.66, 392.00]  // G6
        ],
        cyber: [
            [73.42, 110.00, 130.81, 146.83], // Dm7 (moody)
            [82.41, 123.47, 146.83, 164.81], // Em7
            [110.00, 164.81, 196.00, 220.00], // Am7
            [98.00, 146.83, 174.61, 196.00]  // Gm7
        ],
        cozy: [
            [146.83, 185.00, 220.00, 277.18], // Dmaj7
            [164.81, 207.65, 246.94, 311.13], // Emaj7
            [220.00, 277.18, 329.63, 415.30], // Amaj7
            [146.83, 185.00, 220.00, 277.18]  // Repeat Dmaj7
        ]
    };
    
    let chordIndex = 0;
    
    // Synth loop running every 2.4 seconds
    function playNextChord() {
        if (!state.audio.synthActive) return;
        
        const selectedMelody = elements.synthMelody.value;
        const chords = chordPresets[selectedMelody] || chordPresets.chill;
        const notes = chords[chordIndex];
        
        const now = context.currentTime;
        
        // Trigger 4 oscillators for the chord notes (analog pad glow)
        notes.forEach((freq, i) => {
            const osc = context.createOscillator();
            const nodeGain = context.createGain();
            
            // Mix triangle waves for cozy warmth, plus a tiny detuned sawtooth
            osc.type = i === 3 ? 'sawtooth' : 'triangle';
            osc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 2, now); // soft organic detune
            
            // Slow attack, long decay (analog pad envelope)
            nodeGain.gain.setValueAtTime(0, now);
            nodeGain.gain.linearRampToValueAtTime(0.04, now + 0.6 + i * 0.1);
            nodeGain.gain.setValueAtTime(0.04, now + 1.8);
            nodeGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
            
            osc.connect(nodeGain);
            nodeGain.connect(analyser);
            
            osc.start(now);
            osc.stop(now + 2.5);
            
            // Save for potential cancellation
            synthNodes.push(osc);
        });
        
        // Trigger a cute lofi high bell melody note
        if (Math.random() > 0.3) {
            const bellOsc = context.createOscillator();
            const bellGain = context.createGain();
            
            bellOsc.type = 'sine';
            // Pick a note from the high scale of the chord
            const rootFreq = notes[2] * 2.0;
            bellOsc.frequency.setValueAtTime(rootFreq * (Math.random() > 0.5 ? 1.5 : 1.25), now + 0.4);
            
            bellGain.gain.setValueAtTime(0, now + 0.4);
            bellGain.gain.linearRampToValueAtTime(0.05, now + 0.45);
            bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
            
            bellOsc.connect(bellGain);
            bellGain.connect(analyser);
            
            bellOsc.start(now + 0.4);
            bellOsc.stop(now + 1.9);
            synthNodes.push(bellOsc);
        }
        
        // Simple retro bass kick synth
        const kickOsc = context.createOscillator();
        const kickGain = context.createGain();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(150, now);
        kickOsc.frequency.exponentialRampToValueAtTime(50, now + 0.15);
        
        kickGain.gain.setValueAtTime(0.18, now);
        kickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
        
        kickOsc.connect(kickGain);
        kickGain.connect(analyser);
        kickOsc.start(now);
        kickOsc.stop(now + 0.3);
        synthNodes.push(kickOsc);
        
        // Move to next chord
        chordIndex = (chordIndex + 1) % chords.length;
    }
    
    playNextChord();
    synthInterval = setInterval(playNextChord, 2400);
}

function stopSynthProgression() {
    if (synthInterval) {
        clearInterval(synthInterval);
        synthInterval = null;
    }
    synthNodes.forEach(n => {
        try { n.stop(); } catch (e) {}
    });
    synthNodes = [];
}

// Bind synthesizer controls
document.addEventListener('DOMContentLoaded', () => {
    elements.synthToggle.addEventListener('change', (e) => {
        toggleSynthDemo(e.target.checked);
    });
});
