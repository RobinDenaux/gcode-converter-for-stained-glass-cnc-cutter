import {ParsedGcodeFile} from "../parsing/ParsedGcodeFile.ts";
import {Transformer} from "./Transformer.ts";
import {Line} from "../pathElements/Line.ts";
import {Point} from "../pathElements/Point.ts";
import {Path} from "../pathElements/Path.ts";
import {Arc} from "../pathElements/Arc.ts";

export class AddToolTransition implements Transformer {

    toolOrientationChangeAreaPosition = new Point(5, 5, true);
    private _angularLimit = Math.PI / 8
    private _toolRotationRadius = 5
    public set angularLimit(value : number) {
        this._angularLimit = value / 180 * Math.PI;
    }

    transform(gcode: ParsedGcodeFile): ParsedGcodeFile {
        let lastPosition = new Point(0, 0, false);
        let lastAngle : number | undefined = undefined;
        let i = 0

        gcode.paths.forEach((path, _, array) => {
            const reversePath = path.createReversePath();
            reversePath.reversePath = path;
            path.reversePath = reversePath;
            array.push(reversePath)
        })

        const newList: Path[] = []
        while(gcode.paths.length > 0) {
            let path : Path | undefined = undefined
            let conserveToolRotation = true
            gcode.paths.sort((a, b) => {
                return a.elements[0].startPoint.distanceTo(lastPosition) - b.elements[0].startPoint.distanceTo(lastPosition)
            })
            if(lastAngle !== undefined) {
                path = gcode.paths.find(p => {
                    const diff1 = Math.abs(p.elements[0].startAngle() - lastAngle!);
                    const diff2 = Math.abs((p.elements[0].startAngle() + 2 * Math.PI) % (2 * Math.PI) - (lastAngle! + 2 * Math.PI) % (2 * Math.PI));
                    return Math.min(diff1, diff2) < Math.max(1 / 180 * Math.PI, this._angularLimit)
                })
            }
            if(!path) {
                path = gcode.paths.shift() as Path;
                conserveToolRotation = false
                if(path.reversePath){
                    gcode.paths = gcode.paths.filter(p => p !== path!.reversePath)
                }
            } else {
                gcode.paths = gcode.paths.filter(p => p !== path && p !== path!.reversePath)
            }

            i++
            if(i > 300000) {
                path.elements = []
                break
            }

            lastPosition = path.elements[path.elements.length - 1].endPoint;
            const pathStartingAngle = path.elements[0].startAngle();

            this.addUpAndDownMovement(path, lastPosition)

            if(!conserveToolRotation) {
                if(lastAngle === undefined) {
                    lastAngle = (Math.PI + pathStartingAngle);
                    if(lastAngle > Math.PI) {
                        lastAngle -= 2 * Math.PI;
                    }
                }
                const lastAngleRotationPoint = new Point(this.toolOrientationChangeAreaPosition.x + Math.cos(lastAngle-Math.PI/2) * this._toolRotationRadius,
                    this.toolOrientationChangeAreaPosition.y + Math.sin(lastAngle-Math.PI/2) * this._toolRotationRadius, false);
                const lastAngleRotationPointDown = Point.fromPoint(lastAngleRotationPoint, true)
                const goToStart = new Line("G00", lastPosition, lastAngleRotationPoint);
                const goToStartDown = new Line("G01", lastAngleRotationPoint, lastAngleRotationPointDown);

                const currentAngleRotationPoint = new Point(this.toolOrientationChangeAreaPosition.x + Math.cos(pathStartingAngle+Math.PI/16-Math.PI/2) * this._toolRotationRadius,
                    this.toolOrientationChangeAreaPosition.y + Math.sin(pathStartingAngle+Math.PI/16-Math.PI/2) * this._toolRotationRadius, false);
                const currentAngleRotationPointDown = Point.fromPoint(currentAngleRotationPoint, true);
                const makeRotation = new Arc("G03", lastAngleRotationPoint, currentAngleRotationPointDown, new Point(this.toolOrientationChangeAreaPosition.x, this.toolOrientationChangeAreaPosition.y, true));
                const goToEndUp = new Line("G01", currentAngleRotationPointDown, currentAngleRotationPoint);

                path.elements = [goToStart, goToStartDown, makeRotation, goToEndUp, ...path.elements]
            }

            newList.push(path)

            lastAngle = path.elements[path.elements.length - 2].endAngle();
        }

        gcode.paths = newList;
        return gcode;
    }

    private addUpAndDownMovement(path: Path, lastPosition: Point) {
        const startPointUp = Point.fromPoint(path.elements[0].startPoint, false);
        const startPointDown = Point.fromPoint(path.elements[0].startPoint, true);
        const endPointUp = Point.fromPoint(path.elements[path.elements.length - 1].endPoint, false);
        const endPointDown = Point.fromPoint(path.elements[path.elements.length - 1].endPoint, true);

        const movement = new Line("G00", lastPosition, startPointUp);
        const descent = new Line("G01", startPointUp, startPointDown);
        const ascend = new Line("G01", endPointDown, endPointUp);
        path.elements = [movement, descent, ...path.elements, ascend]
    }
}