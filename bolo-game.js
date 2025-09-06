const animationFramerate = 1000/4
const debug = Object.freeze({
	paint: !!0,
})

const resources = Object.freeze(new Map([
	['game html', fetch('./bolo-game.html').then(response => response.text())],
	['spritesheet', fetch('./spritesheet.png').then(response => response.blob())],
]))

resources.set('spritesheet', 
	await createImageBitmap(
		await resources.get('spritesheet'),
		{ premultiplyAlpha: 'premultiply' }
	)
)

customElements.define('bolo-game', class BoloGameElement extends HTMLElement {
	#syncHashToScreen
	#game
	#keyDownHandler
	#keyUpHandler
	
	constructor() {
		super()
		
		this.shadow = this.attachShadow({ mode: 'closed' })
		this.$ = this.shadow.querySelector.bind(this.shadow)
		this.$$ = this.shadow.querySelectorAll.bind(this.shadow)
		
		this.#syncHashToScreen = () => {
			if (!location.hash || !this.$(location.hash)) location.hash = "game"
			for (screen of this.$$(`[screen]`)) screen.removeAttribute('active')
			this.$(location.hash)?.setAttribute('active', '')
		}
	}
	
	async connectedCallback () {
		const {$,$$} = this
		
		this.shadow.innerHTML = (await resources.get('game html')) || `<h1 style="color:indianred">Error loading game resources.</h1>`
		
		addEventListener('hashchange', this.#syncHashToScreen)
		dispatchEvent(new HashChangeEvent("hashchange")) //Activate a game screen.
		
		const fullscreen = $(`[fullscreen]`)
		if (!document.fullscreenEnabled) {
			console.info('Fullscreen not available.')
			fullscreen.parentNode.remove()
		} else {
			document.addEventListener('fullscreenchange', evt => {
				fullscreen.checked = !!document.fullscreenElement
			})
			fullscreen.addEventListener('change', evt => {
				evt.preventDefault()
				evt.target.checked ? this.requestFullscreen() : document.exitFullscreen()
			})
		}
		
		
		for (const btn of $$(`button[nav]`))
			btn.addEventListener('click', 
				evt => location.hash = evt.target.getAttribute('nav'))
		
		//Set human/computer value when clicking on the label.
		$(`[opponent]`).parentNode.addEventListener('click', evt => {
			if (evt.target.nodeName !== 'LABEL') return
			const toggle = evt.target.children[0]
			const toggleRect = toggle.getBoundingClientRect()
			const pivotPoint = (toggleRect.left + toggleRect.right)/2
			const relativeEventPosition = pivotPoint-evt.pageX
			if (Math.abs(relativeEventPosition) > 75) return
			toggle.value = +(relativeEventPosition < 0)
		})
		
		this.#game = new BoloGame({
			canvas: $(`canvas`),
		})
		
		this.#game.addEventListener('score', ({detail: {team, delta, total}}) => {
			$$(`[score][team]`)[team].textContent = total
		})
		
		this.#game.addEventListener('turn', ({detail: {number}}) => {
			$(`[current-turn]`).textContent = number
		})
		
		this.#game.addEventListener('round', ({detail: {number, of}}) => {
			$(`[current-round]`).textContent = `${number}/${of}`
		})
		
		//Scroll the field of view onto the ball.
		this.#game.addEventListener('movement', ({detail: {x, y}}) => {
			const view = $(`[playfield]`)
			
			const gameSize = { width: view.scrollWidth, height: view.scrollHeight }
			const viewSize = { width: view.clientWidth, height: view.clientHeight }
			
			const canScroll = false
				|| gameSize.width > view.clientWidth
				|| gameSize.height > view.clientHeight
			if (!canScroll) return
			
			const viewMidpoint = { x: viewSize.width/2, y: viewSize.height/2 }
			const canvasStyle = getComputedStyle($(`canvas`))
			const scrollTarget = {
				x: x + parseFloat(canvasStyle.borderLeftWidth), 
				y: y + parseFloat(canvasStyle.borderTopWidth),
			}
			
			view.scrollTo({
				top: scrollTarget.y - viewMidpoint.y,
				left: scrollTarget.x - viewMidpoint.x,
				behavior: "smooth",
			})
		})
		
		const setupGame = ()=>this.#game.setup({
			opponent: parseInt($(`[opponent]`).value, 10) 
				? BoloGame.opponents.human 
				: BoloGame.opponents.computer,
			size: {
				x: parseInt($(`[field="x"]`).value, 10),
				y: parseInt($(`[field="y"]`).value, 10)
			},
			rounds: parseInt($(`[rounds]`).value, 10),
		})
		setupGame()
		
		$(`[new-game]`).addEventListener('click', evt => {
			setupGame()
			location.hash = "game"
		})
		
		let moveTimeoutHandle = 0;
		['left', 'right', 'bowl'].forEach(move =>
			$(`[move="${move}"]`).addEventListener('pointerdown', evt => {
				const target = evt.target //Save target for use in the callback.
				evt.preventDefault()
				this.#game.dispatchEvent(
					new CustomEvent("input", { detail: { 
						command: target.getAttribute('move'),
					}})
				)
				clearTimeout(moveTimeoutHandle)
				const repeat = ()=>{
					if (!target.matches(':active')) return
					this.#game.dispatchEvent(
						new CustomEvent("input", { detail: { 
							command: target.getAttribute('move'),
						}})
					)
					moveTimeoutHandle = setTimeout(repeat, 150)
				}
				moveTimeoutHandle = setTimeout(repeat, 300)
			})
		)
		
		const look = $(`[action="look"]`)
		look.addEventListener(`pointerdown`, evt => {
			evt.preventDefault()
			this.#game.dispatchEvent(
				new CustomEvent("input", { detail: { 
					command: 'look',
					other: true,
				}})
			)
		})
		look.addEventListener(`pointerup`, evt => {
			evt.preventDefault()
			this.#game.dispatchEvent(
				new CustomEvent("input", { detail: { 
					command: 'look',
					other: false,
				}})
			)
		})
		
		const canvas = $(`canvas`)
		const mousePositionBowler = ({offsetX:x, buttons}) => {
			if (buttons !== 1) return
			
			this.#game.dispatchEvent(
				new CustomEvent("input", { detail: { 
					command: 'moveTo',
					column: x/BoloGame.tileSize|0,
				}})
			)
		}
		canvas.addEventListener('pointerdown', mousePositionBowler)
		canvas.addEventListener('pointermove', mousePositionBowler)
		canvas.addEventListener('pointerup', mousePositionBowler)
		
		canvas.addEventListener('pointerup', ({offsetX:x, which}) => {
			if (which !== 1) return; //left-mouse-button-only, not middle, not a tap
			
			this.#game.dispatchEvent(
				new CustomEvent("input", { detail: { 
					command: 'bowl',
				}})
			)
		})
		
		//Accesskey doesn't support arrow keys.
		//evt.target, evt.composedPath() just resolve to this element, no further details.
		this.#keyDownHandler = evt => {
			//console.log(`Key Down: ${evt.code}, Repeat? ${evt.repeat}, ${evt.target}, ${evt.composedPath()}`, evt);
			
			//Ignore anything with modifiers.
			if (evt.altKey || evt.altKey || event.shiftKey || event.metaKey) return
			
			if (['KeyH', 'ArrowLeft'].includes(evt.code))
				this.#game.dispatchEvent(new CustomEvent('input', { detail: { 
					command: 'left',
				}}))
			if (['KeyL', 'ArrowRight'].includes(evt.code))
				this.#game.dispatchEvent(new CustomEvent('input', { detail: { 
					command: 'right',
				}}))
			if (//Ignore enter/space if doing keyboard navigation, since they click the button.
				(this.shadow.activeElement instanceof HTMLButtonElement
					? ['KeyJ', 'ArrowDown']
					: ['KeyJ', 'ArrowDown', 'Space', 'Enter']
				).includes(evt.code) && evt.repeat === false
			)
				this.#game.dispatchEvent(new CustomEvent('input', { detail: { 
					command: 'bowl',
				}}))
			if (['KeyP'].includes(evt.code) && evt.repeat === false)
				this.#game.dispatchEvent(new CustomEvent('input', { detail: { 
					command: 'look',
					other: true,
				}}))
		}
		this.#keyUpHandler = evt => {
			//console.log(`Key Up: ${evt.code}, Repeat? ${evt.repeat}`, evt);
			
			if (['KeyP'].includes(evt.code) && evt.repeat === false)
				this.#game.dispatchEvent(new CustomEvent('input', { detail: { 
					command: 'look',
					other: false,
				}}))
		}
		
		document.addEventListener('keydown', this.#keyDownHandler)
		document.addEventListener('keyup', this.#keyUpHandler)
		
		Object.freeze(this)
	}
	
	disconnectedCallback() {
		removeEventListener('hashchange', this.#syncHashToScreen)
		document.removeEventListener('keydown', this.#keyDownHandler);
		document.removeEventListener('keyup', this.#keyUpHandler)
		this.#game.teardown()
	}
})


customElements.define('bolo-nav-bar', class extends HTMLElement {
	connectedCallback() {
		this.style.display = "flex"
		this.style.flexDirection = "row"
    	this.style.justifyContent = "space-between"
	}
})


customElements.define('bolo-nav-spacer', class extends HTMLElement {
	connectedCallback() {
		this.style.flexGrow = "999"
	}
})


class BoloGame extends EventTarget {
	static opponents = Object.freeze({
		human: Symbol('Human Opponent'), 
		computer: Symbol('Computer Opponent'),
	})
	
	static tileSize = 20;
	
	#opponent
	#_turn
	#_round
	#rounds
	#board = new Board(0,0)
	#canvas
	#startingTeam
	#currentTeam
	#playerColumn = 0
	#playerBalls = [[],[]]
	#playerScore
	#timeouts = new Set() //`setTimeout` handles.
	#intervals = new Set()
	#isBowling = false
	
	constructor({canvas}) {
		super()
		this.#canvas = canvas
		this.addEventListener("input", this.#handleInput.bind(this))
		Object.freeze(this)
	}
	
	async setup({
		opponent=BoloGame.opponents.computer, 
		size: {x=29,y=18}={}, 
		rounds=1
	}={}) {
		for (const handle of this.#timeouts) clearTimeout(handle)
		for (const handle of this.#intervals) clearInterval(handle)
		this.#timeouts.clear()
		this.#intervals.clear()
		
		this.#opponent = opponent
		this.#board = new Board(x,y)
		this.#rounds = rounds
		
		this.#turn = 1 //Setter fires event to sync UI.
		this.#round = 1
		
		this.#playerScore = (boloGame => {
			const scores = [0,0]
			return {
				get 0() { return scores[0] },
				set 0(score) {
					boloGame.dispatchEvent(new CustomEvent("score", { detail: { 
						team: 0, 
						delta: score - scores[0],
						total: scores[0] = score
					}}))
				},
				
				get 1() { return scores[1] },
				set 1(score) {
					boloGame.dispatchEvent(new CustomEvent("score", { detail: { 
						team: 1, 
						delta: score - scores[1],
						total: scores[1] = score
					}}))
				}
			}
		})(this)
		
		this.#playerScore[0] = 0 //fire events for inital UI population
		this.#playerScore[1] = 0
		
		this.#startingTeam = Math.round(Math.random()) //need to know when to increment turn
		this.#currentTeam = this.#startingTeam
		
		this.#isBowling = false
		
		const canvas = this.#canvas
		const ctx = canvas.getContext('2d')
		
		//Set the canvas size and scale so that it renders in high-def.
		canvas.width = x * BoloGame.tileSize * devicePixelRatio
		canvas.height = y * BoloGame.tileSize * devicePixelRatio
		canvas.style.width = `${x * BoloGame.tileSize}px`
		canvas.style.height = `${y * BoloGame.tileSize}px`
		ctx.scale(devicePixelRatio, devicePixelRatio)
		//Now whatever we draw on it will be in constant-sized CSS pixels.
		
		//Set up some further defaults for the canvas.
		ctx.font = "bold 80px sans-serif";
		ctx.textAlign = "center"
		ctx.textBaseline = "middle"
		ctx.fillRect(0, 0, canvas.width, canvas.height)
		ctx.imageSmoothingEnabled = false;
		
		//Generate playfield.
		this.#board.generateMap()
		
		this.#playerBalls[0].length = x
		this.#playerBalls[1].length = x
		this.#playerBalls[0].fill(true)
		this.#playerBalls[1].fill(true)
		
		this.#playerColumn = this.#currentTeam * (this.#playerBalls[this.#currentTeam].length - 1)
		
		this.#drawFullBoard(this.#board);
		this.#drawBalls(this.#playerBalls, this.#currentTeam)
		this.#movePlayer(this.#currentTeam, this.#playerColumn)
		
		for (const pos of this.#board.getTeleporterTiles()) {
			this.#repeat(animationFramerate, function*() {
				yield this.#drawBoard(this.#board, pos)
			}.bind(this))
		}
		
		//Kick off AI turn if it should go first.
		if (this.#currentTeam === 1 && BoloGame.opponents.computer === opponent) {
			await this.#sleep(2000)
			await this.#aiTurn()
		}
	}
	
	teardown() {
		for (const handle in this.#timeouts) cancelTimeout(handle)
	}

	get #round() {
		return this.#_round
	}

	set #round(round) {
		this.#_round = round
		if (round <= this.#rounds)
			this.dispatchEvent(new CustomEvent("round", { detail: { 
				number: round, 
				of: this.#rounds 
			}}))
	}
	
	get #turn() {
		return this.#_turn
	}
	
	set #turn(turn) {
		this.dispatchEvent(new CustomEvent("turn", { detail: { number: turn }}))
		this.#_turn = turn
	}
	
	setScore(team, score) {
		this.dispatchEvent(new CustomEvent("score", { detail: { 
			team, 
			delta: score - this.#playerScore[team],
			total: this.#playerScore[team]
		}}))
		this.#playerScore[team] = score
	}
	
	#drawFullBoard(board) {
		const ctx = this.#canvas.getContext('2d')
		
		board.forEach((cell, y, x) => {
			ctx.save()
			ctx.translate(x * BoloGame.tileSize, y * BoloGame.tileSize)
			ctx.scale(BoloGame.tileSize / 100, BoloGame.tileSize / 100) //Tile sizes are drawn from 0-100.
			cell.draw(ctx, this.#getShadowsAt(board, [x,y]))
			ctx.restore()
		})
	}
	
	#drawBoard(board, [x,y]) {
		const ctx = this.#canvas.getContext('2d')
		
		ctx.save()
		ctx.translate(x * BoloGame.tileSize, y * BoloGame.tileSize)
		ctx.scale(BoloGame.tileSize / 100, BoloGame.tileSize / 100) //Tile sizes are drawn from 0-100.
		board[[x,y]].draw(ctx, this.#getShadowsAt(board, [x,y]))
		ctx.restore()
	}
	
	#getShadowsAt = (board, [x,y]) => ({
		wall: {
			top: Cell.wallShadowCasters.has(board[[x, y-1]].type),
			left: Cell.wallShadowCasters.has(board[[x-1, y]].type),
			corner: Cell.wallShadowCasters.has(board[[x-1, y-1]].type),
		},
		ball: {
		},
	})
	
	#drawBalls(balls, team) {
		const ctx = this.#canvas.getContext('2d')
		
		//First, clear the opponent's balls.
		ctx.save()
		ctx.translate(0, BoloGame.tileSize)
		ctx.scale(BoloGame.tileSize / 100, BoloGame.tileSize / 100) //Tile sizes are drawn from 0-100.
		ctx.fillStyle = "#333"
		ctx.fillRect(0, 0, 100 * this.#board.width, 100)
		ctx.restore()
		
		const row = 1;
		balls[team].forEach((ball, col) => {
			if (ball) drawBall(this.#canvas, team, [col, 1])
		})
	}
	
	#focusOnTile([x,y]) {
		x = x*BoloGame.tileSize + BoloGame.tileSize/2
		y = y*BoloGame.tileSize + BoloGame.tileSize/2
		this.dispatchEvent(new CustomEvent("movement", { detail: {x,y} }))
	}
	
	#movePlayer(team, targetColumn, focus=true) {
		if (this.#round > this.#rounds) return //Don't draw anyone post-game.
		
		this.#drawBoard(this.#board, [this.#playerColumn, 0])
		
		const columns = this.#playerBalls[team].length - 1
		this.#playerColumn = constrain(0, targetColumn, columns)
		
		drawPlayer(this.#canvas.getContext('2d'), this.#playerColumn, team)
		
		if (focus) this.#focusOnTile([this.#playerColumn, 0])
		
		function drawPlayer(ctx, col, team) {
			ctx.save()
			ctx.translate(col * BoloGame.tileSize, 0) //Always on row 0.
			ctx.scale(BoloGame.tileSize / 100, BoloGame.tileSize / 100)
			ctx.translate(0, -10)
			ctx.fillStyle = "lightgrey"
			ctx.fillRect(10, 30, 80, 40)
			ctx.fillStyle = team ? "orangered" : "blue"
			ctx.beginPath()
			ctx.arc(50, 70, 20, 0, 2*Math.PI)
			ctx.fill()
			ctx.beginPath()
			ctx.arc(50, 50, 25, 0, 2*Math.PI)
			ctx.fill()
			ctx.strokeStyle = "#000A"
			ctx.strokeWidth = 5
			ctx.stroke()
			ctx.restore()
		}
	}
	
	#clearPlayer(col=this.#playerColumn) {
		this.#drawBoard(this.#board, [col, 0])
	}
	
	#handleInput({detail: {command, other, column}}) {
		if (this.#isBowling) return //First, don't process any more input if we're still dealing with the last.
		if (this.#currentTeam === 1 && this.#opponent === BoloGame.opponents.computer) return //Computer's got control right now.
		
		switch (command) {
		case 'left':
		case 'right':
			const delta = (command[0]==='r')*2-1
			this.#movePlayer(this.#currentTeam, this.#playerColumn+delta)
			break
		case 'moveTo':
			this.#movePlayer(this.#currentTeam, column)
			break
		case 'bowl':
			this.#bowl()
			break
		case 'look':
			this.#drawBalls(this.#playerBalls, this.#currentTeam ^ other)
			break
		default:
			console.error({command, diagnostic: "unknown command"})
		}
	}
	
	async #bowl() {
		const board = this.#board
		const drawBoard = ([x,y])=>{
			this.#drawBoard(this.#board, [x+0,y+0]); if (y >= 2) //don't over-draw the balls in the rack
			this.#drawBoard(this.#board, [x+1,y+0])
			this.#drawBoard(this.#board, [x+0,y+1])
			this.#drawBoard(this.#board, [x+1,y+1])
		}
		const sleep = this.#sleep.bind(this)
		
		const ballPause = 250
		const tileScanFindDelay = 100
		
		let ballPos = [this.#playerColumn, 1]
		
		//Can't bowl, no ball here.
		if (!this.#playerBalls[this.#currentTeam][this.#playerColumn]) return
		
		//Can't bowl ball due to another ball blocking it.
		if (!Cell.floorTileTypes.has(board[ballPos.with(1,ballPos[1]+1)].type)) return
		
		this.#playerBalls[this.#currentTeam][this.#playerColumn] = false
		this.#isBowling = true
		
		ballPos = await this.#runBowl({
			board,
			drawBoard,
			drawBall: drawBall.bind(null, this.#canvas, this.#currentTeam),
			focus: this.#focusOnTile.bind(this),
			sleep,
			team: this.#currentTeam,
		}, ballPos)
		
		if (ballPos[1] === board.height-1) { //zero-indexed
			await this.#animateWin(ballPos, this.#currentTeam)
		} else {
			const score = (ballPos[1]*2)
			this.#playerScore[this.#currentTeam] += (ballPos[1]*2)
			this.#board[ballPos].state.score = score
			drawBoard(ballPos)
		}
		
		let possibleMoves, possibleMove
		
		this.#currentTeam = +!this.#currentTeam
		if (this.#currentTeam === this.#startingTeam) ++this.#turn
		possibleMoves = this.#getPossibleMoves(board, this.#playerBalls, this.#currentTeam)
		possibleMove = possibleMoves.length //Auto-select the first column with a move.
			? possibleMoves.slice(-this.#currentTeam)[0]
			: this.#currentTeam * (this.#playerBalls[this.#currentTeam].length - 1)
		this.#movePlayer(this.#currentTeam, possibleMove)
		this.#drawBalls(this.#playerBalls, this.#currentTeam)
		
		//If the next player can play, wait for input.
		if (this.#getPossibleMoves(board, this.#playerBalls, this.#currentTeam).length) {
			this.#isBowling = false
			if (this.#currentTeam === 1 && BoloGame.opponents.computer === this.#opponent) {
				await this.#sleep(1000)
				return this.#aiTurn()
			}
			return
		}
		alert(`No moves possible for ${this.#currentTeam ? "red" : "blue"}.`)
		
		//Otherwise, return input to the previous player to play out their hand.
		this.#currentTeam = +!this.#currentTeam
		if (this.#currentTeam === this.#startingTeam) ++this.#turn
		possibleMoves = this.#getPossibleMoves(board, this.#playerBalls, this.#currentTeam)
		possibleMove = possibleMoves.length //Auto-select the first column with a move.
			? possibleMoves.slice(-this.#currentTeam)[0]
			: this.#currentTeam * (this.#playerBalls[this.#currentTeam].length - 1)
		this.#movePlayer(this.#currentTeam, possibleMove)
		this.#drawBalls(this.#playerBalls, this.#currentTeam)
		
		if (this.#getPossibleMoves(board, this.#playerBalls, this.#currentTeam).length) {
			this.#isBowling = false
			if (this.#currentTeam === 1 && BoloGame.opponents.computer === this.#opponent) {
				await this.#sleep(1000)
				return this.#aiTurn()
			}
			return
		}
		this.#clearPlayer(this.#playerColumn)
		--this.#turn
		
		alert("No further moves possible. Removing gray blocks.")
		
		for (let y = board.height-2; y >= 3; y--) {
			for (let x = board.width-1; x >= 0; x--) {
				const tile = board[[x,y]]
				if (tile.type === Cell.types.block) {
					await sleep(tileScanFindDelay)
					tile.type = Cell.types.empty
					drawBoard([x,y])
				}
			}
		}
		
		for (let y = board.height-2; y >= 2; y--) {
			for (let x = board.width-1; x >= 0; x--) {
				const tile = board[[x,y]]
				if (tile.type !== Cell.types.ball) continue
				if (board[[x,y+1]].type !== Cell.types.empty) continue
				
				await sleep(tileScanFindDelay)
				
				const ballTeam = tile.state.team
				tile.type = Cell.types.empty
				
				ballPos = await this.#runBowl({
					board,
					drawBoard,
					drawBall: drawBall.bind(null, this.#canvas, ballTeam),
					focus: this.#focusOnTile.bind(this),
					sleep,
					team: ballTeam,
				}, [x,y])
				
				if (ballPos[1] === board.height-1) { //zero-indexed
					await this.#animateWin(ballPos, ballTeam)
				} else {
					const score = (ballPos[1]*2)
					this.#playerScore[ballTeam] += (ballPos[1]*2)
					this.#board[ballPos].state.score = score
					drawBoard(ballPos)
				}
			}
		}
		
		if (++this.#round > this.#rounds) {
			alert(`Game over!\n${{
				"-1": `Red team wins!`,
				"0": `It's a tie! Good game.`,
				"1": `Blue team wins!`,
			}[Math.sign(this.#playerScore[0] - this.#playerScore[1])]}`)
			return
		}
		
		this.#turn = 0
		
		await sleep(1000)
		
		//Convert all balls to bonus tiles.
		for (let y = board.height-2; y >= 2; y--) {
			for (let x = board.width-1; x >= 0; x--) {
				const tile = board[[x,y]]
				if (tile.type !== Cell.types.ball) continue
				
				await sleep(tileScanFindDelay)	
				
				tile.type = Cell.types.bonus
				tile.state.score = 10
				drawBoard([x,y])
			}
		}
		
		await sleep(1000)
		
		//Repopulate grey blocks.
		for (let y = board.height-2; y > 3; y--) {
			for (let x = board.width-1; x >= 0; x--) {
				const tile = board[[x,y]]
				if (tile.type !== Cell.types.empty) continue
				if (Math.random() > 0.06) continue
				
				await sleep(tileScanFindDelay)	
				
				tile.type = Cell.types.block
				drawBoard([x,y])
			}
		}
		
		//Reset hands.
		this.#playerBalls[0].fill(true)
		this.#playerBalls[1].fill(true)
		
		this.#currentTeam = +!this.#currentTeam
		this.#movePlayer(this.#currentTeam, this.#currentTeam * (this.#playerBalls[this.#currentTeam].length - 1))
		this.#drawBalls(this.#playerBalls, this.#currentTeam)
		
		this.#isBowling = false
		
		if (this.#currentTeam === 1 && BoloGame.opponents.computer === this.#opponent) {
			await this.#sleep(1000)
			return this.#aiTurn()
		}
	}
	
	async #runBowl({board, drawBoard, drawBall, focus, sleep, team}, ballPos) {
		const ballPause = 250
		const ballTeleportPause = 400
		const ballSpeed = 150
		
		const maxTeleports = 5
		let teleports = 0
		
		let momentum = 0 //Needed to track whether we're rolling over balls.
		
		while (1) {
			//Ball at bottom. Clear!
			if (ballPos[1] === board.height-1) break
			
			if (board[ballPos].type === Cell.types.teleport) {
				drawBoard(ballPos)
				const targets = board.getTeleporterTiles()
				for (const target of targets)
					if (target[0] === ballPos[0] && target[1] === ballPos[1])
						targets.delete(target)
				const target = targets.size
					? [...targets][Math.floor(Math.random() * targets.size)]
					: ballPos
				ballPos = (++teleports <= maxTeleports) ? target : ballPos
				drawBall(target), focus(target)
				await sleep(ballTeleportPause)
				
				//There's something below us… try moving out of the way.
				const downCell = board[ballPos.with(1,ballPos[1]+1)]
				if ([Cell.types.block, Cell.types.ball].includes(downCell.type)) {
					const initialDirection = momentum || Math.floor(Math.random()*2)*2-1
					const randomFreeAdjacentTile = [
						ballPos.with(0,ballPos[0] + initialDirection),
						ballPos.with(0,ballPos[0] - initialDirection)
					].map(pos=>({pos, tile:board[pos]}))
					.filter(o=>Cell.floorTileTypes.has(o.tile?.type))[0]
					if (randomFreeAdjacentTile) {
						momentum = randomFreeAdjacentTile.pos[0] -  ballPos[0]
						drawBoard(ballPos)
						ballPos = randomFreeAdjacentTile.pos
						drawBall(ballPos), focus(ballPos)
						await this.#checkBonusCell(randomFreeAdjacentTile.tile, this.#playerScore, team)
						await sleep(ballSpeed)
					} else {
						const tile = board[ballPos]
						tile.type = Cell.types.ball
						tile.state.team = team
						break;
					}
					continue
				} //else fallthrough to the downpos case.
			}
			
			const downPos = ballPos.with(1,ballPos[1]+1)
			const downCell = board[downPos]
			
			if (Cell.floorTileTypes.has(downCell.type)) {
				drawBoard(ballPos)
				ballPos = downPos
				drawBall(ballPos), focus(ballPos)
				await this.#checkBonusCell(downCell, this.#playerScore, team)
				await sleep(ballSpeed)
				continue
			}
			
			const onRamp = Cell.types.ramp === downCell.type
			const onBall = Cell.types.ball === downCell.type
			if (onRamp || onBall) {
				let nPos //"next position"
				
				if (onRamp) {
					if (downCell.state.direction === 1) { //CSS direction indexes start from 0 at the top.
						nPos = ballPos.with(0,ballPos[0]+1)
						sleep(ballSpeed*(1/2)).then(()=>{downCell.state.direction = 2; drawBoard(downPos)})
						sleep(ballSpeed*(2/2)).then(()=>{downCell.state.direction = 3; drawBoard(downPos)})
					} else if (downCell.state.direction === 3) {
						nPos = ballPos.with(0,ballPos[0]-1)
						sleep(ballSpeed*(1/2)).then(()=>{downCell.state.direction = 2; drawBoard(downPos)})
						sleep(ballSpeed*(2/2)).then(()=>{downCell.state.direction = 1; drawBoard(downPos)})
					} else {
						console.error(`Ball on unknown ramp direction ${downCell.state.direction} at ${downPos.join(',')}.`)
						break
					}
					
					momentum = nPos[0] - ballPos[0]
				} else if (onBall && momentum) {
					nPos = ballPos.with(0,ballPos[0]+momentum)
				}
				
				const nCell = board[nPos]
				if (Cell.floorTileTypes.has(nCell?.type)) {
					drawBoard(ballPos)
					ballPos = nPos
					drawBall(ballPos), focus(ballPos)
					await this.#checkBonusCell(nCell, this.#playerScore, team)
					await sleep(ballSpeed)
					continue
				}
			}
			
			//Ball has come to rest.
			const tile = board[ballPos]
			tile.type = Cell.types.ball
			tile.state.team = team
			break
		}
		
		return ballPos
	}
	
	/// Animate the ball rolling off to the side.
	async #animateWin(ballPos, team) {
		const ballWinSpeed = 30
		const ballPause = 250
		
		for (
			let col = ballPos[0];
			col >= 0 && col < this.#board.width;
			col += team * 2 - 1
		) {
			this.#drawBoard(this.#board, ballPos)
			ballPos = ballPos.with(0, col)
			drawBall(this.#canvas, team, ballPos, (ballPos[1]*2)+24)
			this.#focusOnTile(ballPos)
			
			await this.#sleep(ballWinSpeed)
		}
		
		this.#playerScore[team] += (ballPos[1]*2)+24 //equals 60 at the default height
		
		await this.#sleep(ballPause)
		this.#drawBoard(this.#board, ballPos)
		await this.#sleep(ballPause)
	}
	
	
	async #checkBonusCell(cell, scoreboard, team) {
		if (Cell.types.bonus !== cell.type) return
		await this.#sleep(250)
		scoreboard[team] += cell.state.score
		cell.type = Cell.types.empty
	}
	
	
	//async, must be awaited
	#sleep(ms) {
		return new Promise(resolve => {
			const handle = setTimeout(()=>resolve(handle), ms)
			this.#timeouts.add(handle)
		}).then(handle=>this.#timeouts.delete(handle))
	}
	
	//non-async, takes an iterable
	#repeat(ms, iter) {
		const step = ()=>{
			if(iter().next().done) {
				this.#intervals.remove(handle)
			}
		}
		
		const handle = setInterval(step, ms)
		this.#intervals.add(handle)
		step()
		return handle
	}
	
	
	#getPossibleMoves(board, balls, turn) {
		return balls[turn].reduce(
			(indices, ballIsAvailable, index) =>
				Cell.floorTileTypes.has(ballIsAvailable && board[[index,2]].type)
					? (indices.push(index), indices)
					: indices,
			[]
		)
	}
	
	async #aiTurn() {
		const aiMoveSpeed = 100
		const moves = this.#getPossibleMoves(this.#board, this.#playerBalls, this.#currentTeam)
		const aiTargetColumn = moves[Math.floor(Math.random() * moves.length)]
		
		do {
			const closer = Math.sign(aiTargetColumn - this.#playerColumn)
			this.#movePlayer(this.#currentTeam, this.#playerColumn+closer)
			await this.#sleep(aiMoveSpeed)
		} while (this.#playerColumn != aiTargetColumn)
		
		await this.#sleep(500)
		this.#bowl()
	}
}


class Board {
	#teleporters = new Set()
	
	constructor(width, height) {
		const outOfBoundsCell = new Cell()
		outOfBoundsCell.type = Cell.types.block
		Object.freeze(outOfBoundsCell)
		Object.freeze(outOfBoundsCell.state)
		const board = this
		
		return new Proxy([], {
			get(target, prop, rec) {
				if (prop == "undefined") return undefined
				
				if (prop == "width") return width
				if (prop == "height") return height
				if (prop == "generateMap") return (params={}) => board.#generateMap(rec, params)
				if (prop == "getTeleporterTiles") return () => board.#getTeleporterTiles(rec)
				if (prop == "map") return cb => target.map((row, r)=>row.map((tile, c) => cb(tile, r, c, rec)))
				if (prop == "forEach") return cb => target.forEach((row, r)=>row.forEach((tile, c) => cb(tile, r, c, rec)))
				
				const [x,y] = prop.split(',').map(c=>parseInt(c, 10))
				
				if (x < 0 || x >= width) return outOfBoundsCell;
				if (y < 0 || y >= height) return outOfBoundsCell;
				
				let row = target[y]
				if (!row) row = target[y] = []
				let cell = row[x]
				if (!cell) cell = row[x] = new Cell()
				
				return cell
			}
		})
	}
	
	#generateMap(board, {manyTeleporters=Math.random()<0.05}) {
		this.#teleporters.clear()
		
		for (let x = 0; x < board.width; x++)
			board[[x,0]].type = Cell.types.path
		
		for (let x = 0; x < board.width; x++)
			board[[x,1]].type = Cell.types.rack
		
		for (let x = 0; x < board.width; x++)
			board[[x,2]].type = Cell.types.empty
		
		for (let y = 3; y < board.height - 1; y++) {
			for (let x = 0; x < board.width; x++) {
				const chance = Math.random()
				if (chance < (manyTeleporters ? 0.04 : 0.01)) {
					board[[x,y]].type = Cell.types.teleport
					this.#teleporters.add([x,y])
					continue
				}
				if (chance < 0.8) {
					board[[x,y]].type = Cell.types.empty
					continue
				}
				if (chance < 0.83) {
					board[[x,y]].type = Cell.types.block
					continue
				}
				if (chance < 0.85) {
					board[[x,y]].type = Cell.types.bonus
					board[[x,y]].state.score = 20
					continue
				}
				if (chance < 1) {
					board[[x,y]].type = Cell.types.ramp
					board[[x,y]].state.direction = Math.random() < 0.5 ? 1 : 3
					continue
				}
			}
		}
		
		for (let x = 0; x < board.width; x++)
			board[[x,board.height-1]].type = Cell.types.empty
		
		scan: for (let x = 0; x < board.width; x++) {
			for (var y = 3; y < board.height - 1; y++) {
				if (![Cell.types.empty, Cell.types.bonus].includes(board[[x,y]].type))
					continue scan
			}
			y = Math.floor(Math.random() * (board.height-6))+4
			board[[x,y]].type = Cell.types.ramp
			board[[x,y]].state.direction = Math.random() < 0.5 ? 1 : 3
		}
		
		return board
	}
	
	#getTeleporterTiles(board) {
		//Scan to make sure all teleporters are actually still alive - a ball could have landed on one and overwritten it if it couldn't move.
		for (const pos of this.#teleporters) {
			if (board[pos].type !== Cell.types.teleport) {
				this.#teleporters.delete(pos)
			}
		}
		
		return new Set(this.#teleporters) //return a copy so we can't muck up internal state by mutating the original
	}
}

class Cell {
	static types = Object.freeze({
		empty: Symbol('Empty Cell'),
		block: Symbol('Block Cell'),
		ramp: Symbol('Ramp Cell'),
		teleport: Symbol('Teleport Cell'),
		ball: Symbol('Ball Cell'),
		bonus: Symbol('Bonus Cell'),
		path: Symbol('Path'),
		rack: Symbol('Rack'),
	})
	
	static floorTileTypes = Object.freeze(
		new Set([Cell.types.empty, Cell.types.teleport, Cell.types.bonus])
	)
	
	static wallShadowCasters = Object.freeze(
		new Set([Cell.types.block, Cell.types.ramp, Cell.types.rack])
	)
	
	type = Cell.types.empty
	state = {}
	variation = Math.random() //stable random number, used to determine which variant of the tile to draw, say for floors.
	
	draw(ctx, shadows={wall:{}, ball:{}}) {
		if (Cell.types.path === this.type) {
			const tiles = spritesheet[Cell.types.path]
			const variation = Math.floor(this.variation*tiles.length)
			ctx.drawImage(spritesheet.image, ...tiles[variation], ...defaultTarget)
		}
		
		else if (Cell.types.rack === this.type) {
			ctx.fillStyle = "#333"
			ctx.fillRect(0, 0, 100, 100)
		}
		
		else if (Cell.types.ramp === this.type) {
			ctx.drawImage(spritesheet.image, ...spritesheet[Cell.types.ramp][this.state.direction], ...defaultTarget)
		}
		
		else if (Cell.types.block === this.type) {
			ctx.drawImage(spritesheet.image, ...spritesheet[Cell.types.block], ...defaultTarget)
		}
		
		else {
			if (Cell.types.teleport === this.type) {
				ctx.drawImage(spritesheet.image, ...spritesheet["teleport base hole"], ...defaultTarget)
			}
			
			else if (Cell.types.bonus === this.type) {
				const amount = this.state.score
				const measurements = ctx.measureText(amount)
				const heightOffset = (measurements.actualBoundingBoxDescent - measurements.actualBoundingBoxAscent) / 2
				ctx.drawImage(spritesheet.image, ...spritesheet[Cell.types.bonus], ...defaultTarget)
				ctx.fillStyle = "black"
				ctx.font = "normal 40pt sans-serif"
				ctx.fillText(amount, 50, 50 - heightOffset, 80)
			}
			
			else if ([Cell.types.empty, Cell.types.ball].includes(this.type)) {
				const tiles = spritesheet[Cell.types.empty]
				const variation = Math.floor(this.variation*tiles.length)
				ctx.drawImage(spritesheet.image, ...tiles[variation], ...defaultTarget)
			}
			
			if (shadows.ball.left || shadows.ball.top) {
				console.error('TODO: Issue #2.')
				debugger
			}
			
			if (shadows.wall.top || shadows.wall.left || shadows.wall.corner) {
				ctx.drawImage(spritesheet.image, ...[
					96 + (shadows.wall.left + shadows.wall.corner*2)*16,
					48 + shadows.wall.top*16,
					16,
					16,
				], ...defaultTarget)
			}
			
			if (Cell.types.ball === this.type) {
				drawBall(ctx, this.state.team, null, this.state.score)
			}
			
			else if (Cell.types.teleport === this.type) {
				const tiles = spritesheet[Cell.types.teleport]
				const startFrame = Math.floor(this.variation*tiles.length)
				const animFrame = Math.floor(performance.now() / animationFramerate)
				const frame = (startFrame + animFrame) % tiles.length
				ctx.drawImage(spritesheet.image, ...tiles[frame], ...defaultTarget)
			}
		}
		
		if (debug.paint) {
			ctx.fillStyle = `oklch(0.7368 0.1739 ${Math.random()*360} / 32.24%)`
			ctx.fillRect(0,0,100,100)
		}
		
	}
}

//Note: Must be after the definition of Cell, not before, or Board can't see Cell.
//This seems to be because of `resources.get('spritesheet')` breaking it. But WHY‽
const spritesheet = Object.freeze({
	__proto__: null,
	
	image: resources.get('spritesheet'),
	
	[Cell.types.ball]: [
		[16,16,16,16], //blue
		[32,16,16,16], //red
	],
	
	"ball shadow": [48, 16, 16, 16],
	"ball shadow left fringe": [64, 16, 16, 16],
	"ball shadow top fringe": [48, 32, 16, 16],
	
	//"wall shadow" is custom, but starts at [96,48].
	
	[Cell.types.empty]: [
		[0, 80, 16, 16], [16, 80, 16, 16], [32, 80, 16, 16],
		[0, 96, 16, 16], [16, 96, 16, 16],
	],
	
	[Cell.types.block]: [80,80,16,16],
	
	[Cell.types.ramp]: [
		[ 64, 112, 16, 16], //unused but makes the math line up
		[ 80, 112, 16, 16],
		[ 96, 112, 16, 16],
		[112, 112, 16, 16],
	],
	
	[Cell.types.bonus]: [80,144,16,16],
	
	[Cell.types.teleport]: Array.from({length:8}, (_,i)=>[80+16*i,176,16,16]),
	
	"teleport base hole": [224, 176, 16, 16],
	
	[Cell.types.path]: [
		[80,208,16,16],
		[96,208,16,16],
	],
	
	font: {
		white:  Array.from({length:10}, (_,i)=>[176+8*i,32,7,9]),
		black:  Array.from({length:10}, (_,i)=>[176+8*i,42,7,9]),
		yellow: Array.from({length:10}, (_,i)=>[176+8*i,52,7,9]),
	}
})

const defaultTarget = Object.freeze([0,0,100,100])

function drawBall(canvas, team, pos, text="") { //canvas is canvas *context* if pos is 0.
	const ctx = pos ? canvas.getContext('2d') : canvas
	if (pos) {
		const [col, row] = pos
		const ctx = canvas.getContext('2d')
		ctx.save()
		ctx.translate(col * BoloGame.tileSize, row * BoloGame.tileSize)
		ctx.scale(BoloGame.tileSize / 100, BoloGame.tileSize / 100) //Tile sizes are drawn from 0-100.
	}
	
	ctx.drawImage(spritesheet.image, ...spritesheet["ball shadow"], ...defaultTarget)
	ctx.drawImage(spritesheet.image, ...spritesheet[Cell.types.ball][team], ...defaultTarget)
	
	if (debug.paint) {
		ctx.beginPath();
		ctx.arc(50, 50, 25, 0, 2 * Math.PI); //centerX, centerY, radius, startAngle, endAngle
		ctx.fillStyle = `oklch(0.6685 0.2405 ${Math.random()*360} / 89.62%)`
		ctx.fill();   // Optional: fills the circle
	}
	
	if (text) {
		const measurements = ctx.measureText(text)
		const heightOffset = (measurements.actualBoundingBoxDescent - measurements.actualBoundingBoxAscent) / 2
		ctx.fillStyle = "black"
		ctx.font = "normal 40pt sans-serif"
		ctx.fillText(text, 50, 50 - heightOffset, 80)
	}
	
	if (pos) ctx.restore()
}


///min <= val <= max, or (min+max)/2
function constrain(min, val, max) {
	if (max < min) return (max + min)/2 
	return Math.min(Math.max(val, min), max)
}