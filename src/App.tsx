import GaussianBlur from "./GaussianBlur";
import "./App.css";

export default function App() {
	return (
		<div className="app-layout">
			<div className="container">
				<h1>Gaussian Blur</h1>
				<p className="description">
					Exploring how Gaussian-blurred density distributions look
					when rendered as a heatmap. Each cell represents the number
					of responses placed in that region of a 100×100 grid, with
					values falling off from cluster centres following a
					Gaussian decay.
				</p>

				<GaussianBlur />
			</div>
		</div>
	);
}
