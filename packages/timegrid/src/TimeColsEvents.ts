import {
  htmlEscape, cssToStr,
  applyStyle,
  createFormatter, DateFormatter,
  FgEventRenderer, buildSegCompareObj,
  Seg, isMultiDayRange, compareByFieldSpecs,
  computeEventDraggable, computeEventStartResizable, computeEventEndResizable, ComponentContext, BaseFgEventRendererProps, subrenderer, isArraysEqual
} from '@fullcalendar/core'
import { attachSegs, detachSegs } from './TimeCols'
import TimeColsSlatsCoords from './TimeColsSlatsCoords'

export interface TimeColsEventsProps extends BaseFgEventRendererProps {
  containerEls: HTMLElement[]
  forPrint: boolean
  coords: TimeColsSlatsCoords
}

/*
Only handles foreground segs.
Does not own rendering. Use for low-level util methods by TimeCols.
*/
export default class TimeColsEvents extends FgEventRenderer<TimeColsEventsProps> {

  private updateFormatter = subrenderer(this._updateFormatter)
  private attachSegs = subrenderer(attachSegs, detachSegs)

  private fullTimeFormat: DateFormatter // computed options
  private segsByCol: any // for sizing


  render(props: TimeColsEventsProps, context: ComponentContext) {
    let { coords } = props
    this.updateFormatter(context.options)

    let segs = this.renderSegs({
      segs: props.segs,
      selectedInstanceId: props.selectedInstanceId,
      hiddenInstances: props.hiddenInstances,
      isDragging: props.isDragging,
      isResizing: props.isResizing,
      isSelecting: props.isSelecting,
      interactingSeg: props.interactingSeg
    })

    this.segsByCol = this.attachSegs({
      segs,
      containerEls: props.containerEls
    })

    if (coords) {
      this.computeSegSizes(segs, coords)
      this.assignSegSizes(segs, coords)
    }
  }


  _updateFormatter(allOptions) {
    this.fullTimeFormat = createFormatter({
      hour: 'numeric',
      minute: '2-digit',
      separator: allOptions.defaultRangeSeparator
    })
  }


  computeSegSizes(allSegs: Seg[], slatCoords: TimeColsSlatsCoords) {
    let { segsByCol } = this
    let colCnt = this.props.containerEls.length

    slatCoords.computeSegVerticals(allSegs) // horizontals relies on this

    for (let col = 0; col < colCnt; col++) {
      computeSegHorizontals(segsByCol[col], this.context) // compute horizontal coordinates, z-index's, and reorder the array
    }
  }


  assignSegSizes(allSegs: Seg[], slatCoords: TimeColsSlatsCoords) {
    let { segsByCol } = this
    let colCnt = this.props.containerEls.length

    slatCoords.assignSegVerticals(allSegs) // horizontals relies on this

    for (let col = 0; col < colCnt; col++) {
      this.assignSegCss(segsByCol[col], slatCoords)
    }
  }


  // Given foreground event segments that have already had their position coordinates computed,
  // assigns position-related CSS values to their elements.
  assignSegCss(segs: Seg[], slatCoords: TimeColsSlatsCoords) {

    for (let seg of segs) {
      applyStyle(seg.el, this.generateSegCss(seg, slatCoords))

      if (seg.level > 0) {
        seg.el.classList.add('fc-time-grid-event-inset')
      }

      // if the event is short that the title will be cut off,
      // attach a className that condenses the title into the time area.
      if (
        !this.props.forPrint &&
        seg.eventRange.def.title && seg.bottom - seg.top < 30
      ) {
        seg.el.classList.add('fc-short') // TODO: "condensed" is a better name
      } else {
        seg.el.classList.remove('fc-short') // ugh
      }
    }
  }


  // Generates an object with CSS properties/values that should be applied to an event segment element.
  // Contains important positioning-related properties that should be applied to any event element, customized or not.
  generateSegCss(seg: Seg, slatCoords: TimeColsSlatsCoords) {
    let { isRtl, options } = this.context
    let shouldOverlap = options.slotEventOverlap
    let backwardCoord = seg.backwardCoord // the left side if LTR. the right side if RTL. floating-point
    let forwardCoord = seg.forwardCoord // the right side if LTR. the left side if RTL. floating-point
    let props = slatCoords.generateSegVerticalCss(seg) as any // get top/bottom first
    let left // amount of space from left edge, a fraction of the total width
    let right // amount of space from right edge, a fraction of the total width

    if (shouldOverlap) {
      // double the width, but don't go beyond the maximum forward coordinate (1.0)
      forwardCoord = Math.min(1, backwardCoord + (forwardCoord - backwardCoord) * 2)
    }

    if (isRtl) {
      left = 1 - forwardCoord
      right = backwardCoord
    } else {
      left = backwardCoord
      right = 1 - forwardCoord
    }

    props.zIndex = seg.level + 1 // convert from 0-base to 1-based
    props.left = left * 100 + '%'
    props.right = right * 100 + '%'

    if (shouldOverlap && seg.forwardPressure) {
      // add padding to the edge so that forward stacked events don't cover the resizer's icon
      props[isRtl ? 'marginLeft' : 'marginRight'] = 10 * 2 // 10 is a guesstimate of the icon's width
    }

    return props
  }


  // Computes a default event time formatting string if `eventTimeFormat` is not explicitly defined
  computeEventTimeFormat() {
    return {
      hour: 'numeric',
      minute: '2-digit',
      meridiem: false
    }
  }


  // Computes a default `displayEventEnd` value if one is not expliclty defined
  computeDisplayEventEnd() {
    return true
  }


  // Renders the HTML for a single event segment's default rendering
  renderSegHtml(seg: Seg, isDragging: boolean, isResizing: boolean, isSelecting: boolean) {
    let eventRange = seg.eventRange
    let eventDef = eventRange.def
    let eventUi = eventRange.ui
    let allDay = eventDef.allDay
    let isDraggable = computeEventDraggable(this.context, eventDef, eventUi)
    let isResizableFromStart = seg.isStart && computeEventStartResizable(this.context, eventDef, eventUi)
    let isResizableFromEnd = seg.isEnd && computeEventEndResizable(this.context, eventDef, eventUi)
    let classes = this.getSegClasses(seg, isDraggable, isResizableFromStart || isResizableFromEnd, isDragging, isResizing, isSelecting)
    let skinCss = cssToStr(this.getSkinCss(eventUi))
    let timeText
    let fullTimeText // more verbose time text. for the print stylesheet
    let startTimeText // just the start time text

    classes.unshift('fc-time-grid-event')

    // if the event appears to span more than one day...
    if (isMultiDayRange(eventRange.range)) {
      // Don't display time text on segments that run entirely through a day.
      // That would appear as midnight-midnight and would look dumb.
      // Otherwise, display the time text for the *segment's* times (like 6pm-midnight or midnight-10am)
      if (seg.isStart || seg.isEnd) {
        let unzonedStart = seg.start
        let unzonedEnd = seg.end
        timeText = this._getTimeText(unzonedStart, unzonedEnd, allDay) // TODO: give the timezones
        fullTimeText = this._getTimeText(unzonedStart, unzonedEnd, allDay, this.fullTimeFormat)
        startTimeText = this._getTimeText(unzonedStart, unzonedEnd, allDay, null, false) // displayEnd=false
      }
    } else {
      // Display the normal time text for the *event's* times
      timeText = this.getTimeText(eventRange)
      fullTimeText = this.getTimeText(eventRange, this.fullTimeFormat)
      startTimeText = this.getTimeText(eventRange, null, false) // displayEnd=false
    }

    return '<a class="' + classes.join(' ') + '"' +
      (eventDef.url ?
        ' href="' + htmlEscape(eventDef.url) + '"' :
        ''
        ) +
      (skinCss ?
        ' style="' + skinCss + '"' :
        ''
        ) +
      '>' +
        '<div class="fc-content">' +
          (timeText ?
            '<div class="fc-time"' +
            ' data-start="' + htmlEscape(startTimeText) + '"' +
            ' data-full="' + htmlEscape(fullTimeText) + '"' +
            '>' +
              '<span>' + htmlEscape(timeText) + '</span>' +
            '</div>' :
            ''
            ) +
          (eventDef.title ?
            '<div class="fc-title">' +
              htmlEscape(eventDef.title) +
            '</div>' :
            ''
            ) +
        '</div>' +
        /* TODO: write CSS for this
        (isResizableFromStart ?
          '<div class="fc-resizer fc-start-resizer"></div>' :
          ''
          ) +
        */
        (isResizableFromEnd ?
          '<div class="fc-resizer fc-end-resizer"></div>' :
          ''
          ) +
      '</a>'
  }

}

TimeColsEvents.addPropsEquality({
  containerEls: isArraysEqual
})


// Given an array of segments that are all in the same column, sets the backwardCoord and forwardCoord on each.
// Assumed the segs are already ordered.
// NOTE: Also reorders the given array by date!
function computeSegHorizontals(segs: Seg[], context: ComponentContext) {
  let levels
  let level0
  let i

  // why do we need to clear!?
  for (let seg of segs) {
    seg.forwardCoord = null
    seg.backwardCoord = null
    seg.forwardPressure = null
  }

  levels = buildSlotSegLevels(segs)
  computeForwardSlotSegs(levels)

  if ((level0 = levels[0])) {

    for (i = 0; i < level0.length; i++) {
      computeSlotSegPressures(level0[i])
    }

    for (i = 0; i < level0.length; i++) {
      computeSegForwardBack(level0[i], 0, 0, context)
    }
  }
}


// Calculate seg.forwardCoord and seg.backwardCoord for the segment, where both values range
// from 0 to 1. If the calendar is left-to-right, the seg.backwardCoord maps to "left" and
// seg.forwardCoord maps to "right" (via percentage). Vice-versa if the calendar is right-to-left.
//
// The segment might be part of a "series", which means consecutive segments with the same pressure
// who's width is unknown until an edge has been hit. `seriesBackwardPressure` is the number of
// segments behind this one in the current series, and `seriesBackwardCoord` is the starting
// coordinate of the first segment in the series.
function computeSegForwardBack(seg: Seg, seriesBackwardPressure, seriesBackwardCoord, context: ComponentContext) {
  let forwardSegs = seg.forwardSegs
  let i

  if (seg.forwardCoord == null) { // not already computed

    if (!forwardSegs.length) {

      // if there are no forward segments, this segment should butt up against the edge
      seg.forwardCoord = 1
    } else {

      // sort highest pressure first
      sortForwardSegs(forwardSegs, context)

      // this segment's forwardCoord will be calculated from the backwardCoord of the
      // highest-pressure forward segment.
      computeSegForwardBack(forwardSegs[0], seriesBackwardPressure + 1, seriesBackwardCoord, context)
      seg.forwardCoord = forwardSegs[0].backwardCoord
    }

    // calculate the backwardCoord from the forwardCoord. consider the series
    seg.backwardCoord = seg.forwardCoord -
      (seg.forwardCoord - seriesBackwardCoord) / // available width for series
      (seriesBackwardPressure + 1) // # of segments in the series

    // use this segment's coordinates to computed the coordinates of the less-pressurized
    // forward segments
    for (i = 0; i < forwardSegs.length; i++) {
      computeSegForwardBack(forwardSegs[i], 0, seg.forwardCoord, context)
    }
  }
}


function sortForwardSegs(forwardSegs: Seg[], eventOrderSpecs) {
  let objs = forwardSegs.map(buildTimeGridSegCompareObj)

  let specs = [
    // put higher-pressure first
    { field: 'forwardPressure', order: -1 },
    // put segments that are closer to initial edge first (and favor ones with no coords yet)
    { field: 'backwardCoord', order: 1 }
  ].concat(eventOrderSpecs)

  objs.sort(function(obj0, obj1) {
    return compareByFieldSpecs(obj0, obj1, specs)
  })

  return objs.map(function(c) {
    return c._seg
  })
}


// Builds an array of segments "levels". The first level will be the leftmost tier of segments if the calendar is
// left-to-right, or the rightmost if the calendar is right-to-left. Assumes the segments are already ordered by date.
function buildSlotSegLevels(segs: Seg[]) {
  let levels = []
  let i
  let seg
  let j

  for (i = 0; i < segs.length; i++) {
    seg = segs[i]

    // go through all the levels and stop on the first level where there are no collisions
    for (j = 0; j < levels.length; j++) {
      if (!computeSlotSegCollisions(seg, levels[j]).length) {
        break
      }
    }

    seg.level = j;

    (levels[j] || (levels[j] = [])).push(seg)
  }

  return levels
}


// For every segment, figure out the other segments that are in subsequent
// levels that also occupy the same vertical space. Accumulate in seg.forwardSegs
function computeForwardSlotSegs(levels) {
  let i
  let level
  let j
  let seg
  let k

  for (i = 0; i < levels.length; i++) {
    level = levels[i]

    for (j = 0; j < level.length; j++) {
      seg = level[j]

      seg.forwardSegs = []
      for (k = i + 1; k < levels.length; k++) {
        computeSlotSegCollisions(seg, levels[k], seg.forwardSegs)
      }
    }
  }
}


// Figure out which path forward (via seg.forwardSegs) results in the longest path until
// the furthest edge is reached. The number of segments in this path will be seg.forwardPressure
function computeSlotSegPressures(seg: Seg) {
  let forwardSegs = seg.forwardSegs
  let forwardPressure = 0
  let i
  let forwardSeg

  if (seg.forwardPressure == null) { // not already computed

    for (i = 0; i < forwardSegs.length; i++) {
      forwardSeg = forwardSegs[i]

      // figure out the child's maximum forward path
      computeSlotSegPressures(forwardSeg)

      // either use the existing maximum, or use the child's forward pressure
      // plus one (for the forwardSeg itself)
      forwardPressure = Math.max(
        forwardPressure,
        1 + forwardSeg.forwardPressure
      )
    }

    seg.forwardPressure = forwardPressure
  }
}


// Find all the segments in `otherSegs` that vertically collide with `seg`.
// Append into an optionally-supplied `results` array and return.
function computeSlotSegCollisions(seg: Seg, otherSegs: Seg[], results= []) {

  for (let i = 0; i < otherSegs.length; i++) {
    if (isSlotSegCollision(seg, otherSegs[i])) {
      results.push(otherSegs[i])
    }
  }

  return results
}


// Do these segments occupy the same vertical space?
function isSlotSegCollision(seg1: Seg, seg2: Seg) {
  return seg1.bottom > seg2.top && seg1.top < seg2.bottom
}


function buildTimeGridSegCompareObj(seg: Seg) {
  let obj = buildSegCompareObj(seg)

  obj.forwardPressure = seg.forwardPressure
  obj.backwardCoord = seg.backwardCoord

  return obj
}
