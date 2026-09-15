/**
 * The part of a Stream Deck key the actions use. The SDK's `KeyAction` is one, and a test's fake is
 * another, which is what keeps every decision about a key testable without the Stream Deck app.
 */
export interface KeyFace {
    readonly id: string;
    setTitle(title?: string): Promise<void>;
    setImage(image?: string): Promise<void>;
    setState(state: number): Promise<void>;
    showOk(): Promise<void>;
    showAlert(): Promise<void>;
}

/** What a key should show. An absent field is left as it is; `setImage(undefined)` is the manifest's own image. */
export interface Frame {
    title?: string;
    image?: string;
    state?: number;
}

interface Painted {
    face: KeyFace;
    title?: string;
    image?: string;
    state?: number;
}

/**
 * The keys an action is showing on, and what each was last told.
 *
 * A key redraws every half second while a record plays, and almost every one of those changes
 * nothing, so a frame is sent only where it differs from the last one that key was sent. A key
 * appearing has been told nothing and gets everything.
 *
 * A send that fails is dropped rather than thrown: it fails because the app has let the key go, and
 * the key going is its own event.
 */
export class FacePainter {
    private readonly keys = new Map<string, Painted>();

    get size(): number {
        return this.keys.size;
    }

    add(face: KeyFace): void {
        this.keys.set(face.id, { face });
    }

    remove(id: string): void {
        this.keys.delete(id);
    }

    get(id: string): KeyFace | undefined {
        return this.keys.get(id)?.face;
    }

    ids(): string[] {
        return [...this.keys.keys()];
    }

    paintAll(frame: Frame): void {
        for (const painted of this.keys.values()) this.draw(painted, frame);
    }

    /** One key's frame, for an action whose keys differ from one another. */
    paint(id: string, frame: Frame): void {
        const painted = this.keys.get(id);
        if (painted !== undefined) this.draw(painted, frame);
    }

    private draw(painted: Painted, frame: Frame): void {
        const { face } = painted;
        if (frame.state !== undefined && frame.state !== painted.state) {
            painted.state = frame.state;
            face.setState(frame.state).catch(ignore);
        }
        if (frame.image !== undefined && frame.image !== painted.image) {
            painted.image = frame.image;
            face.setImage(frame.image).catch(ignore);
        }
        if (frame.title !== undefined && frame.title !== painted.title) {
            painted.title = frame.title;
            face.setTitle(frame.title).catch(ignore);
        }
    }
}

function ignore(): void {}
