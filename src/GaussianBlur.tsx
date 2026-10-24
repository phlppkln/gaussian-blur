import * as d3 from "d3";
import { useEffect, useRef, useState } from "react";

import { CHART_SURFACE_MUTED, CHART_TEXT_PRIMARY } from "./chartTokens";
import "./GaussianBlur.css";

// ── Types ──────────────────────────────────────────────────
type CellTriplet = [number, number, number];

export interface HeatmapDef {
	title: string;
	size: number;
	xLabelMap: Record<string, string>;
	yLabelMap: Record<string, string>;
	cells: CellTriplet[];
	maxVal: number;
}

interface ImageDef {
	title: string;
	path: string;
	author: string;
	authorUrl: string;
	sourceUrl: string;
}

interface RenderParams {
	def: HeatmapDef;
	sigma: number;
	imgDef: ImageDef | null;
}

// ── Constants ──────────────────────────────────────────────
const SIGMA_MAX = 10;
const AUTO_STEP = 0.1; // sigma units per tick
const AUTO_INTERVAL_MS = 50; // ~20 fps

const IMAGES: ImageDef[] = [
	{
		title: "Malaysian Tiger",
		path: "/img/artisticoperations-malaysian-tiger-8363779_1920.jpg",
		author: "ArtisticOperations",
		authorUrl:
			"https://pixabay.com/users/artisticoperations-4161274/?utm_source=link-attribution&utm_medium=referral&utm_campaign=image&utm_content=8363779",
		sourceUrl:
			"https://pixabay.com//?utm_source=link-attribution&utm_medium=referral&utm_campaign=image&utm_content=8363779",
	},
	{
		title: "Indonesia",
		path: "/img/fls3n_kab_cianjur-indonesia-10276956_1920.jpg",
		author: "FLS3N_KAB_CIANJUR",
		authorUrl:
			"https://pixabay.com/users/fls3n_kab_cianjur-55670022/?utm_source=link-attribution&utm_medium=referral&utm_campaign=image&utm_content=10276956",
		sourceUrl:
			"https://pixabay.com//?utm_source=link-attribution&utm_medium=referral&utm_campaign=image&utm_content=10276956",
	},
];

const imageCache = new Map<string, HTMLImageElement>();

// ── Image loading ──────────────────────────────────────────
function loadImage(url: string): Promise<HTMLImageElement> {
	const cached = imageCache.get(url);
	if (cached) return Promise.resolve(cached);
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			imageCache.set(url, img);
			resolve(img);
		};
		img.onerror = reject;
		img.src = url;
	});
}

// ── Gaussian blur ──────────────────────────────────────────
function applyGaussianBlur(
	baseCells: CellTriplet[],
	size: number,
	s: number
): { cells: CellTriplet[]; maxVal: number } {
	const radius = Math.ceil(3 * s);
	const kernelLen = 2 * radius + 1;

	// Build normalised kernel as a plain number[] to avoid noUncheckedIndexedAccess issues
	const rawKernel: number[] = [];
	let kSum = 0;
	for (let i = 0; i < kernelLen; i++) {
		const x = i - radius;
		const kv = Math.exp(-(x * x) / (2 * s * s));
		rawKernel.push(kv);
		kSum += kv;
	}
	const kernel: number[] = rawKernel.map((kv) => kv / kSum);

	const grid = new Float32Array(size * size);
	for (const [ri, ci, val] of baseCells) {
		if (ri < size && ci < size) grid[ri * size + ci] = val;
	}

	// Horizontal pass
	const temp = new Float32Array(size * size);
	for (let r = 0; r < size; r++) {
		for (let c = 0; c < size; c++) {
			let v = 0;
			for (let k = 0; k < kernelLen; k++) {
				const nc = c + k - radius;
				if (nc >= 0 && nc < size)
					v += (grid[r * size + nc] ?? 0) * (kernel[k] ?? 0);
			}
			temp[r * size + c] = v;
		}
	}

	// Vertical pass
	const out = new Float32Array(size * size);
	for (let r = 0; r < size; r++) {
		for (let c = 0; c < size; c++) {
			let v = 0;
			for (let k = 0; k < kernelLen; k++) {
				const nr = r + k - radius;
				if (nr >= 0 && nr < size)
					v += (temp[nr * size + c] ?? 0) * (kernel[k] ?? 0);
			}
			out[r * size + c] = v;
		}
	}

	let newMax = 0;
	const result: CellTriplet[] = [];
	for (let r = 0; r < size; r++) {
		for (let c = 0; c < size; c++) {
			const v: number = out[r * size + c] ?? 0;
			if (v > 0.001) {
				if (v > newMax) newMax = v;
				result.push([r, c, v]);
			}
		}
	}
	return { cells: result, maxVal: newMax };
}

// ── Rendering ──────────────────────────────────────────────
function appendCard(container: HTMLElement, title: string): HTMLElement {
	d3.select(container).selectAll("*").remove();

	const wrapper = d3
		.select(container)
		.append("div")
		.style("background", "#ffffff")
		.style("border-radius", "8px")
		.style("box-shadow", "0 2px 12px rgba(0,0,0,0.10)")
		.style("overflow", "hidden")
		.node()!;

	d3.select(wrapper)
		.append("div")
		.style("padding", "12px 14px 8px")
		.style("font-family", "'Space Grotesk', sans-serif")
		.style("font-size", "15px")
		.style("font-weight", "700")
		.style("color", CHART_TEXT_PRIMARY)
		.text(title);

	return wrapper;
}

function appendCanvas(
	wrapper: HTMLElement,
	W: number,
	H: number
): CanvasRenderingContext2D {
	const canvas = d3
		.select(wrapper)
		.append("canvas")
		.attr("width", W)
		.attr("height", H)
		.style("width", "100%")
		.style("height", "auto")
		.style("display", "block")
		.node()!;

	return canvas.getContext("2d")!;
}

function renderHeatmap(
	container: HTMLElement,
	def: HeatmapDef,
	sigmaVal: number
) {
	const { title, size, cells: baseCells, maxVal: baseMax } = def;

	const { cells, maxVal } =
		sigmaVal > 0.05
			? applyGaussianBlur(baseCells, size, sigmaVal)
			: { cells: baseCells, maxVal: baseMax };

	const CELL_PX = size <= 5 ? 90 : size <= 15 ? 38 : 6;

	const wrapper = appendCard(container, title);

	const W = size * CELL_PX;
	const H = size * CELL_PX;

	const ctx = appendCanvas(wrapper, W, H);
	ctx.fillStyle = CHART_SURFACE_MUTED;
	ctx.fillRect(0, 0, W, H);

	// Color scale — same scheme as original
	const colorFn = (v: number) =>
		v === 0
			? CHART_SURFACE_MUTED
			: d3.interpolateBlues(0.15 + 0.85 * (v / maxVal));

	for (const [ri, ci, val] of cells) {
		if (ri >= size || ci >= size || val === 0) continue;
		ctx.fillStyle = colorFn(val);
		ctx.fillRect(ci * CELL_PX, ri * CELL_PX, CELL_PX, CELL_PX);
	}
}

// ── Image mode rendering ───────────────────────────────────
async function renderImageCanvas(
	container: HTMLElement,
	def: HeatmapDef,
	sigmaVal: number,
	imgDef: ImageDef
) {
	// Load image before clearing DOM so old canvas stays visible during fetch
	const img = await loadImage(imgDef.path);

	const IMG_W = 960;
	const IMG_H = 640; // 3:2 to match 1920×1280 source

	const wrapper = appendCard(container, def.title);
	const ctx = appendCanvas(wrapper, IMG_W, IMG_H);

	// Draw original image as the base layer
	ctx.drawImage(img, 0, 0, IMG_W, IMG_H);

	if (sigmaVal > 0.05) {
		const { size, cells: baseCells } = def;
		const cellW = IMG_W / size;
		const cellH = IMG_H / size;

		// Gaussian-blurred heatmap drives the mask shape and feathering
		const { cells: maskCells, maxVal: maskMax } = applyGaussianBlur(
			baseCells,
			size,
			sigmaVal
		);

		// Build an alpha mask from the blurred heatmap values
		const maskCanvas = document.createElement("canvas");
		maskCanvas.width = IMG_W;
		maskCanvas.height = IMG_H;
		const maskCtx = maskCanvas.getContext("2d")!;
		for (const [ri, ci, val] of maskCells) {
			if (ri >= size || ci >= size) continue;
			const alpha = val / maskMax;
			maskCtx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
			maskCtx.fillRect(
				Math.round(ci * cellW),
				Math.round(ri * cellH),
				Math.ceil(cellW),
				Math.ceil(cellH)
			);
		}

		// Blur the full image on an offscreen canvas (GPU-accelerated CSS filter)
		const pixelBlur = sigmaVal * cellW;
		const blurCanvas = document.createElement("canvas");
		blurCanvas.width = IMG_W;
		blurCanvas.height = IMG_H;
		const blurCtx = blurCanvas.getContext("2d")!;
		blurCtx.filter = `blur(${pixelBlur.toFixed(1)}px)`;
		blurCtx.drawImage(img, 0, 0, IMG_W, IMG_H);
		blurCtx.filter = "none";

		// Clip blurred image to the heatmap mask regions
		blurCtx.globalCompositeOperation = "destination-in";
		blurCtx.drawImage(maskCanvas, 0, 0);

		// Composite the masked blur on top of the original
		ctx.drawImage(blurCanvas, 0, 0);
	}
}

// ── Component ──────────────────────────────────────────────
export default function GaussianBlur() {
	const [loading, setLoading] = useState(true);
	const [allDefs, setAllDefs] = useState<HeatmapDef[]>([]);
	const [activeIndex, setActiveIndex] = useState(0);
	const [sigma, setSigma] = useState(0);
	const [autoMode, setAutoMode] = useState(false);
	const [imageMode, setImageMode] = useState(false);
	const [activeImageIndex, setActiveImageIndex] = useState(0);
	const currentImage = IMAGES[activeImageIndex];

	const hmContainer = useRef<HTMLDivElement | null>(null);
	const autoDir = useRef(1);
	const isRendering = useRef(false);
	// Latest requested frame; renders that arrive mid-render are coalesced
	const pending = useRef<RenderParams | null>(null);

	// ── Data loading ───────────────────────────────────────
	useEffect(() => {
		let cancelled = false;
		fetch("/data/gaussian-blur.json")
			.then((res) => res.json())
			.then((defs: HeatmapDef[]) => {
				if (cancelled) return;
				setAllDefs(defs);
				setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// ── Unified render ─────────────────────────────────────
	useEffect(() => {
		const def = allDefs[activeIndex];
		if (!def) return;
		pending.current = {
			def,
			sigma,
			imgDef: imageMode ? (currentImage ?? null) : null,
		};
		if (isRendering.current) return;

		(async () => {
			isRendering.current = true;
			try {
				while (pending.current && hmContainer.current) {
					const { def, sigma, imgDef } = pending.current;
					pending.current = null;
					if (imgDef)
						await renderImageCanvas(
							hmContainer.current,
							def,
							sigma,
							imgDef
						);
					else renderHeatmap(hmContainer.current, def, sigma);
				}
			} finally {
				isRendering.current = false;
			}
		})();
	}, [allDefs, activeIndex, sigma, imageMode, currentImage]);

	// ── Auto mode ──────────────────────────────────────────
	useEffect(() => {
		if (!autoMode) return;
		const id = setInterval(() => {
			setSigma((prev) => {
				let next =
					Math.round((prev + AUTO_STEP * autoDir.current) * 10) / 10;
				if (next >= SIGMA_MAX) {
					next = SIGMA_MAX;
					autoDir.current = -1;
				} else if (next <= 0) {
					next = 0;
					autoDir.current = 1;
				}
				return next;
			});
		}, AUTO_INTERVAL_MS);
		return () => clearInterval(id);
	}, [autoMode]);

	function toggleAuto() {
		if (!autoMode) autoDir.current = sigma >= SIGMA_MAX ? -1 : 1;
		setAutoMode(!autoMode);
	}

	if (loading) {
		return (
			<div className="gaussian-blur-wrapper">
				<div className="loading">Loading data…</div>
			</div>
		);
	}

	return (
		<div className="gaussian-blur-wrapper">
			{/* Mode toggle */}
			<div className="mode-nav">
				<button
					className={`mode-btn${!imageMode ? " active" : ""}`}
					onClick={() => setImageMode(false)}
				>
					Demo
				</button>
				<button
					className={`mode-btn${imageMode ? " active" : ""}`}
					onClick={() => setImageMode(true)}
				>
					Image
				</button>
			</div>

			{/* Image selector (image mode only) */}
			{imageMode && (
				<div className="variant-nav">
					{IMAGES.map((img, i) => (
						<button
							key={i}
							className={`variant-btn${i === activeImageIndex ? " active" : ""}`}
							onClick={() => setActiveImageIndex(i)}
						>
							{img.title}
						</button>
					))}
				</div>
			)}

			{/* Pattern selector (both modes) */}
			<div className="variant-nav">
				{allDefs.map((def, i) => (
					<button
						key={i}
						className={`variant-btn${i === activeIndex ? " active" : ""}`}
						onClick={() => setActiveIndex(i)}
					>
						{def.title}
					</button>
				))}
			</div>

			{/* Controls (both modes) */}
			<div className="controls">
				<div className="slider-group">
					<label className="control-label">
						Blur σ{" "}
						<span className="sigma-val">{sigma.toFixed(1)}</span>
					</label>
					<input
						type="range"
						min="0"
						max={SIGMA_MAX}
						step="0.1"
						value={sigma}
						className="sigma-slider"
						onChange={(e) => setSigma(Number(e.target.value))}
					/>
				</div>
				<button
					className={`auto-btn${autoMode ? " active" : ""}`}
					onClick={toggleAuto}
				>
					{autoMode ? "Stop" : "Auto"}
				</button>
			</div>

			{/* Canvas area */}
			<div ref={hmContainer} className="heatmap-block" />

			{/* Attribution (image mode only) */}
			{imageMode && currentImage && (
				<p className="attribution">
					Image by{" "}
					<a
						href={currentImage.authorUrl}
						target="_blank"
						rel="noopener noreferrer"
					>
						{currentImage.author}
					</a>{" "}
					from{" "}
					<a
						href={currentImage.sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
					>
						Pixabay
					</a>
				</p>
			)}
		</div>
	);
}
