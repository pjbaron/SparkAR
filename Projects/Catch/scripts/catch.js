/*
    Catch a falling polyhedron in your gob.
    Pete Baron 20/03/2020
*/

// update frequency of state machine
const INTERVAL = 250;
// range at which falling items are eaten
const RANGE = 0.06;
// y value where falling items are reset to the top (0)
const BOTTOM = -0.7;
// time period for shapes to fall all the way to the bottom
const SPEED = 3.0;
// openness threshold for mouth to be eating
const MOUTH_OPEN = 0.12;


const Scene = require('Scene');
const Time = require('Time');
const Random = require('Random');
const Reactive = require('Reactive');
const FaceTracking = require('FaceTracking');
const Diagnostics = require('Diagnostics');


/*
    Tween
    @chrisError 20 / 02 / 2020
*/

// All valid ease type strings:

// "linear",
// "easeInBounce", "easeOutBounce"
// "easeInBack", "easeOutBack"
// "easeInCirc", "easeOutCirc"
// "easeInCubic", "easeOutCubic"
// "easeInElastic", "easeOutElastic"
// "easeInExpo", "easeOutExpo"
// "easeInOutBack", "easeInOutBounce"
// "easeInOutCirc", "easeInOutElastic"
// "easeInOutExpo", "easeInOutQuad"
// "easeInOutQuart", "easeInOutSine"
// "easeInQuad", "easeOutQuad"
// "easeInQuart", "easeOutQuart"
// "easeInQuint", "easeOutQuint"
// "easeInSine", "easeOutSine"


const Animation = require('Animation');

class Tween
{
    /// @param: completedCallback - if you need a context, specify the parameter as e.g. () => thiscompleteCallbackName()
    constructor(startVal, endVal, duration, loopCount, mirror, ease, completedCallback)
    {
        let timeDriverParams = {
            durationMilliseconds: duration * 1000,
            loopCount: loopCount == -1 ? Infinity : loopCount,
            mirror: mirror
        };
        this.driver = Animation.timeDriver(timeDriverParams);

        try
        {
            this.sampler = Animation.samplers[ease](startVal, endVal);
        }
        catch (e)
        {
            Diagnostics.log("ERROR: Invalid ease type: " + ease);
        }

        this.sub = undefined;
        if (completedCallback)
        {
            this.sub = this.driver.onCompleted().subscribe(completedCallback);
        }

        this.driver.start();
        this.animation = Animation.animate(this.driver, this.sampler);
    }

    Dispose()
    {
        this.driver.stop();
        if (this.sub)
        {
            this.sub.unsubscribe();
        }
        this.animation = null;
        this.driver = null;
        this.sampler = null;
        this.sub = null;
    }
}



// states for the state machine
export const STATES =
{
    Invalid: 0,
    Init: 1,
    WaitPool: 2,
    Tick: 3,
    Catch: 4
};


class CatchFall
{
    constructor()
    {
        // system
        this.root = Scene.root;
        this.camera = this.root.child('Device').child('Camera');

        // objects to drop
        this.pool = this.root.find('Pool');

        // face tracking
        this.face = FaceTracking.face(0);
        this.faceTransform = this.face.cameraTransform;
        this.mouth = this.face.mouth;

        // bindings
        this.mouthTracker = this.root.find('MouthTracker');
        this.eating = this.mouth.openness.gt(Reactive.val(MOUTH_OPEN));

        // locals
        this.state = STATES.Invalid;
        
        // timer to run the state machine
        this.intervalTimer = undefined;
    }


    Start()
    {
        // start up the state machine
        this.state = STATES.Init;
        this.intervalTimer = Time.setInterval(() => this.StateMachine(), INTERVAL);
    }


    StateMachine()
    {
        switch(this.state)
        {
            case STATES.Init:
                // mouth tracking from the face
                this.mouthTracker.hidden = true;
                this.mouthTracker.position = this.mouth.center;

                // retrieve all items from the pool
                this.items = null;
                this.pool.findByPath('*').then((x) => { this.items = x; });

                this.state = STATES.WaitPool;
                break;

            case STATES.WaitPool:
                if (this.items != null)
                {
                    this.distances = [];
                    // hide the pool items and add tracking for their distance from the user's mouth
                    for(var i = 0; i < this.items.length; i++)
                    {
                        var item = this.items[i];
                        item.hidden = true;
                        this.distances[i] = this.mouthTracker.worldTransform.position.distance(item.worldTransform.position);
                    }
                    this.state = STATES.Tick;
                }
                break;

            case STATES.Tick:
                const r = Math.floor(Random.random() * this.items.length);
                var item = this.items[r];
                if (!item.falling)
                {
                    item.falling = true;
                    item.hidden = false;
                    item.tween = new Tween(0.0, BOTTOM, SPEED, 1, false, "easeInQuad", () => this.ResetAtBottom());
                    item.transform.x = Random.random() * 0.2 - 0.1;
                    item.transform.y = item.tween.animation;
                }

                const caughtItem = this.CatchFallingItem();
                if (caughtItem)
                {
                    this.EatItem(caughtItem);
                }
                break;

            case STATES.Catch:
                break;
        }
    }


    ResetAtBottom()
    {
        let item = this.FindLowestItem();
        if (item)
        {
            this.ResetItemToTop(item);
        }
    }


    ResetItemToTop(item)
    {
        item.falling = false;
        item.hidden = true;
        item.transform.y = 0;
        item.transform.scale = Reactive.scale(Reactive.val(1),Reactive.val(1),Reactive.val(1));
        if (item.tween)
        {
            item.tween.Dispose();
            item.tween = null;
        }
    }


    EatItem(item)
    {
        // TODO: tween it to the exact mouth location
        // TODO: on arrival, if mouth is closed bounce off, else shrink and vanish
        if (this.eating.pinLastValue())
        {
            item.falling = false;

            if (item.tween)
            {
                item.tween.Dispose();
                item.tween = null;
            }

            // shrink then remove
            item.tween = new Tween(1.0, 0.0, 0.25, 1, false, "easeInQuad", () => this.ResetItemToTop(item));
            item.transform.scale = Reactive.scale(item.tween.animation, item.tween.animation, item.tween.animation);
        }
    }


    CatchFallingItem()
    {
        for(var i = 0; i < this.items.length; i++)
        {
            if (this.items[i].falling && this.distances[i].pinLastValue() < RANGE)
            {
                return this.items[i];
            }
        }
        return null;
    }


    FindLowestItem()
    {
        var lowest = null;
        var min = 0;
        for(var i = 0; i < this.items.length; i++)
        {
            var item = this.items[i];
            if (item.transform.y.pinLastValue() < min)
            {
                min = item.transform.y.pinLastValue();
                lowest = item;
            }
        }
        return lowest;
    }
}


// create and start the game
new CatchFall().Start();
