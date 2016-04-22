/* global macro chilipeppr $ */
/* 

============ MACRO XTC (Automatic Tool Changer) ================================

This macro is used for an Automatic Toolchanger. This woll control the used gcode 
and try to find the Toolchnages, use the Toolnumber to identify the correct Toolholder.
This Macro remember on the used tool and find the correct strategie to let the 
actual used tool in the holder and get a new one.

This will parse the comment to get gcode from commandline i.e.:
   M6 T2
after this command, the machine are in pause mode and we can change
the tool. Here the flow:

   * check if a tool used (T1)
   * put the used tool to holder
      * move to holder with toolnumber == 1
      * set spindle speed and level
      * move down in the nut
      * loose the nut with full power and negative current sense 
         (i.e: -4000, if the current fall under 4Ampere then stop)
      * got to safety height   
   * get the next toolnumber(T2)
      * move to holder with toolnumber == 2
      * set spindle speed and level
      * move down in the nut
      * tight the nut with full power and for a specific time 
         (i.e: fwd 300 500, set 75% power and tight the collet for 0.5 sec)
      * got to safety height
   * call unpause the M6 Stop
   
  
And then it sends commands to a Arduino+DC Spindle Controller
to pre-poition, tight or loose the ER11 Collet.

To test this with tinyg2 or tinyg follow this steps:
   * use SPJS 1.89
   * use url http://chilipeppr.com/tinyg?v9=true
   * set linenumbers on
   * in tinyg widget set "No init CMD's Mode"
   * choose "tinygg2" in SPJS Widget

*/
if (!Array.prototype.last)
    Array.prototype.last = function(){
        return this[this.length - 1];
    };

var myXTCMacro = {
      serialPortXTC:    "/dev/ttyUSB2", // XTC Controlelr
      atcParameters: {
         level:   800,     // the current level in mA where the spindle will break
         revlevel:-3000,   // the reverse level in mA where the spindle will break
         forward: 30,      // value for minimum rpm
         safetyHeight: 35, // safety height
         feedRate: 300,    // Feedrate to move over the catch cable
         nutZ: -7,         // safety deep position of collet in nut
    },
    atcMillHolder: [
      // Center Position holder, catch height, tighten value, how long tighten in milliseconds
      // ---------|-------------|-------------|--------------------------------
      {posX : -235, posY : 26.5,   posZ: 5,   tourque: 300, time: 500}, // first endmill holder
    ],
   feedRate: 100,
   toolnumber: 0,
	toolinuse: 0,
   axis: {x:0, y:0, z:0},
   events: [],
	init: function() {
      // Uninit previous runs to unsubscribe correctly, i.e.
      // so we don't subscribe 100's of times each time we modify
      // and run this macro
      if (window["myXTCMacro"]) {
         macro.status("This macro was run before. Cleaning up...");
         window["myXTCMacro"].uninit();
         window["myXTCMacro"] = undefined;
      }

      // store macro in window object so we have it next time thru
      window["myXTCMacro"] = this;

      // Check for Automatic Toolchange Command
      chilipeppr.subscribe("/com-chilipeppr-interface-cnccontroller/axes", this, this.updateAxesFromStatus);
      chilipeppr.subscribe("/com-chilipeppr-widget-serialport/onComplete", this, this.onComplete);
      chilipeppr.subscribe("/com-chilipeppr-interface-cnccontroller/status", this, this.onStateChanged);
      
      chilipeppr.publish("/com-chilipeppr-elem-flashmsg/flashmsg", "XDisPlace Macro", "Send commands to second xdisplace cnccontroller for ATC");
      
      this.getGcode();
   },
   uninit: function() {
      macro.status("Uninitting chilipeppr_pause macro.");
      chilipeppr.unsubscribe("/com-chilipeppr-interface-cnccontroller/axes", this, this.updateAxesFromStatus);
      chilipeppr.unsubscribe("/com-chilipeppr-widget-serialport/onComplete", this, this.onComplete);		
      chilipeppr.unsubscribe("/com-chilipeppr-interface-cnccontroller/status", this, this.onStateChanged);
   },
   onStateChanged: function(state){
      console.log('ATC State:', state, this);
      this.State = state;
   },
	getGcode: function() {
		chilipeppr.subscribe("/com-chilipeppr-widget-gcode/recvGcode", this, this.getGcodeCallback);
		chilipeppr.publish("/com-chilipeppr-widget-gcode/requestGcode", "");
		chilipeppr.unsubscribe("/com-chilipeppr-widget-gcode/recvGcode", this.getGcodeCallback);
	},
	getGcodeCallback: function(data) {
		this.gcode = data;
	},
   // Add control DC Spindle for M3 and M5, M30 will unset all parameters
	onComplete: function(data) {
		console.log('ATC onComplete', data);
		// Id's from the Gcode widget always start with g
		// If you jog, use the serial port console, or do other stuff we'll 
		// see callbacks too, but we only want real gcode data here
		if (data.Id.match(/^g(\d+)/)) {
			// $1 is populated with digits from the .match regex above
			var index = parseInt(RegExp.$1,10); 
			// our id is always 1 ahead of the gcode.lines array index, i.e.
			// line 1 in the widget is this.gcode.lines[0]
            // Ignore empty lines
			if(this.gcode === undefined)
			   return;

			var gcodeline = this.gcode.lines[index - 1];

            // Ignore empty lines
			if(gcodeline === undefined)
			   return;
			
			// Try to match M3, M5, and M30 (program end)
			// The \b is a word boundary so looking for M3 doesn't also
			// hit on M30
			if (gcodeline.match(/\bM5\b/i) || gcodeline.match(/\bM30\b/i)) {
				// turn spindle off
				// TODO: switched off to fast!
				chilipeppr.publish("/com-chilipeppr-widget-serialport/ws/send", "send " + this.serialPortXTC + " brk\n");
			} else if (gcodeline.match(/\bM3\b/i)) {
				// turn spindle on
				chilipeppr.publish("/com-chilipeppr-widget-serialport/ws/send", "send " + this.serialPortXTC + " fwd 400\n");
			} else if (gcodeline.match(/\bM6\b/i)) {
            if(gcodeline.match(/T(\d+)/)){
                this.onATC({toolnumber: parseInt(RegExp.$1,10)});
            }
			}
		}
	},

   updateAxesFromStatus: function (axes) {
      console.log("ATC updateAxesFromStatus:", axes);
      if ('x' in axes && axes.x !== null) {
          this.axis.x = axes.x;
      }
      if ('y' in axes && axes.y !== null) {
          this.axis.y = axes.y;
      }
      if ('z' in axes && axes.z !== null) {
          this.axis.z = axes.z;
      }

      var that = this;

      // check all events and compare the axis states with event states
      // if has the event xyz the same values as the actual position
      // then fire up the planned event
      this.events.forEach(function(entry){
         if(entry.x == that.axis.x && entry.y == that.axis.y && entry.z == that.axis.z){
            entry.event.resolve();                                // Fire up the event
            console.log('ATC fire Event: ', entry.comment);
         }
      });
   },


   onATC: function(data){
      console.log('ATC Execute Line:', data);

      // now the machine is in pause mode
      // cuz M6 linenumber are the same as actual linenumber
      // and we can do whatever we like :)
      console.log('ATC Process:', this);

      this.toolnumber = data.toolnumber;
      this.events = [];

      // check if a different tool in use
      if(this.toolinuse > 0 && this.toolinuse != this.toolnumber){
         this.atc_move_to_holder(this.toolinuse, 'unscrew'); // move to holder and unscrew
      } 
      else if(this.toolnumber > 0){
         // get new tool from holder, if neccessary
   	   this.atc_move_to_holder(this.toolnumber, 'screw'); // move to holder and screw
      }
   },

   atc_move_to_holder: function( toolnumber, art ){
      // wait on main cnccontroller's stop state (think asynchron!)
      if(this.State != "Stop"){ // wait for idle state
         setTimeout(this.atc_move_to_holder.bind(this, toolnumber), 250);
         return;
      }

      console.log('ATC called: ', 'atc_move_to_holder', toolnumber);

      // get parameters for millholder
      var atcparams = this.atcParameters;
      var holder = this.atcMillHolder[ (toolnumber-1) ]; 

      if($.type(holder) !== 'object')
         return;

      // -------------------- EVENT Planning -----------------------------------

      // Prepare event StartSpindleSlow ----------------------------------------
      var startSpindleSlow = $.Deferred();
      var startSpindleSlowZPos = atcparams.safetyHeight;

      // add a rule if startSpindleSlow event happend
      $.when( startSpindleSlow )
         .done( this.startSpindle.bind(this, atcparams.forward, atcparams.level) );

      // register the event for updateAxesFromStatus, 
      // the cool thing this event will only one time fired :)
      this.events.push({ x:holder.posX,  y:holder.posY,  z:startSpindleSlowZPos,
         event: startSpindleSlow,
         comment: 'Start spindle slow for pre-position.',
      });


      // Prepare event looseCollet ---------------------------------------------
      var looseCollet = $.Deferred();
      var looseColletZPos = atcparams.nutZ+2;

      // add a rule if looseCollet event happend after startSpindleSlow
      $.when( startSpindleSlow, looseCollet )
         .done( this.atc_unscrew.bind(this) );

      // register the event for updateAxesFromStatus, 
      // the cool thing this event will only one time fired :)
      this.events.push({ x:holder.posX,  y:holder.posY,  z:looseColletZPos,
         event: looseCollet,
         comment: 'Rotate spindle backwards with full power for 0.5 seconds.',
      });

      // Prepare event tightCollet ---------------------------------------------
      var tightCollet = $.Deferred();
      var tightColletZPos = atcparams.nutZ;
      
      // add a rule if tightCollet event happend
      $.when( startSpindleSlow, tightCollet )
         .done( this.atc_screw.bind(this) );

      // register the event for updateAxesFromStatus, 
      // the cool thing this event will only one time fired :)
      this.events.push({ x:holder.posX,  y:holder.posY,  z:tightColletZPos,
         event: tightCollet,
         comment: 'Rotate spindle forward with full power for 0.5 seconds.',
      });

      // Prepare event unpause ---------------------------------------------
      var unpause = $.Deferred();
      var unpausedZPos = atcparams.safetyHeight+0.1;
      
      // add a rule if unpause event happend 
      // after startSpindleSlow and tightCollet 
      $.when( startSpindleSlow, tightCollet, unpause )
         .done( this.unpauseGcode.bind(this, art) );

      // register the event for updateAxesFromStatus, 
      // the cool thing this event will only one time fired :)
      this.events.push({ x:holder.posX,  y:holder.posY,  z:unpausedZPos,
         event: unpause,
         comment: 'Unpause the process and do the job.',
      });

      // -------------------- EVENT Planning -- END ----------------------------

      var nutZ = (art === 'unscrew' ? looseColletZPos : tightColletZPos);

      // now move spindle to the holder position
      // first to safetyHeight ...
      var cmd;
      cmd += "G0 Z" + atcparams.safetyHeight + "\n";
      // then to holder center ...
      cmd += "G0 X" + holder.posX + " Y" + holder.posY + "\n"; 
      // then to holder Z pre-position height ...
      cmd += "G0 Z" + holder.posZ + "\n";
      // slowly to the minus end ollet Z position  ...
      cmd += "G0 Z" + nutZ + " F" + atcparams.feedRate + "\n";
      cmd += "G4 P1\n"; // wait a second
      // move to event position for safetyHeight 
      cmd += "G0 Z" + unpausedZPos + "\n";   
      
      chilipeppr.publish("/com-chilipeppr-widget-serialport/send", cmd);
   },

   startSpindle: function(speed, level){
      var cmd = "send " + this.serialPortXTC + " " 
                  + "fwd " + (speed+100) + "\n" 
                  + "fwd " + speed + "\n" 
                  + "lev " + level + "\n";
      chilipeppr.publish("/com-chilipeppr-widget-serialport/ws/send", cmd);
      console.log('ATC spindle', cmd);
   },

   // Event to move to savetyHeight in Z Axis
   atc_sec_height: function(){
      console.log('ATC called: ', 'atc_sec_height');

      var cmd = "G0 Z" + this.atcParameters.safetyHeight + "\n";
      chilipeppr.publish("/com-chilipeppr-widget-serialport/send", cmd);
   },

   // Event to move to unscrew the collet
   atc_unscrew: function(){
      // ok action == moved, now we can loose nut and move the machine 
      console.log('ATC called: ', 'atc_unscrew');
      var holder = this.atcMillHolder[ (this.toolinuse-1)];
      
      // unscrew process
      // rotate backward with more power(+50) as the tight process    
      var cmd = "send " + this.serialPortXTC + " " 
         + "bwd " + (holder.tourque+50) + " " + holder.time + "\n";  
      chilipeppr.publish("/com-chilipeppr-widget-serialport/ws/send", cmd);

      // unset tool in use
      this.toolinuse = 0;
   },

   atc_screw: function(data){
      // ok state == moved, now we can tighten nut and move the machine 
      console.log('ATC called: ', 'atc_screw');
      var holder = this.atcMillHolder[ (this.toolnumber -1)];
      
      // tighten process
      var cmd = "send " + this.serialPortXTC + " " 
                  + "fwd " + holder.tourque + " " + holder.time + "\n";
      chilipeppr.publish("/com-chilipeppr-widget-serialport/ws/send", cmd);

      // set tool in use
      this.toolinuse = this.toolnumber;
   },

   unpauseGcode: function(art) {
      console.log('ATC called: ', 'unpauseGcode', art);

      if(art === 'unscrew' && this.toolnumber > 0){
         // Ok, put the last tool in holder now we get the next one
         this.onATC({toolnumber: this.toolnumber});
         return;
      }

      chilipeppr.publish("/com-chilipeppr-widget-gcode/pause", "");
   },
};
// call init from cp 
// myXTCMacro.init();