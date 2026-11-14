import test from 'node:test';import assert from 'node:assert/strict';import {chooseAlternative,transcriptParts} from '../js/dj-recognition.js';
test('close recognition alternatives can use known artists without inventing text',()=>{
 const choices=[{transcript:'play tailor swift',confidence:.8},{transcript:'play Taylor Swift',confidence:.79}];assert.equal(chooseAlternative(choices,[{artist:'Taylor Swift'}]),'play Taylor Swift');assert.equal(chooseAlternative(choices,[]),'play tailor swift');
 assert.equal(chooseAlternative([{transcript:'play the weekend',confidence:.95},{transcript:'play The Weeknd',confidence:.4}],[{artist:'The Weeknd'}]),'play the weekend');
});
test('full utterances retain spaces and separate provisional words',()=>{
 const result=transcriptParts([Object.assign([{transcript:'can you play'}],{isFinal:true}),Object.assign([{transcript:'some jazz'}],{isFinal:false})],[]);
 assert.deepEqual(result,{final:'can you play',interim:'some jazz',text:'can you play some jazz'});
});
