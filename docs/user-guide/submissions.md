# Submissions: the two-week routine (owner)

Drive test › Submissions (Drive test app, under Tests) sends the villages whose drive test is done to ICT HQ,
keeps UEP's own record of what went, and lists what ICT HQ has not registered.

1. **Open Ready to submit.** It lists every drive-tested village not yet sent,
   by site. *By reason* on the right narrows it (New DT site, Missed, Became
   هدف, Re-send); *New since* shows only what became ready since the last
   letter. Untick anything that should wait.
2. **Create the draft batch.** *Create draft batch #n* locks the ticked villages
   so nobody sends them twice. On the batch page, remove a village with ×, or
   *Cancel draft* to release them all.
3. **Download the Excel and send the letter.** The button in the batch header
   downloads `MTN_Irancell_Drive_Test_n.xlsx` in ICT's 18-column format. Send it
   with the MTN letter as usual.
4. **Mark as sent.** Enter the MTN letter number and its Shamsi date, attach
   the scan, and press *Mark as sent*. When ICT HQ and CRA HQ forward it, add
   their letters on the batch page (*Add letter*); both are optional.
5. **Follow up.** Mojri confirms receipt about a month later. *Follow up with
   ICT* lists villages sent 30+ days before the latest Mojri file and still not
   in it. Select them, *Export list for ICT*, then *Mark raised with ICT*; or
   *Send again* to put a village back in Ready for the next batch. A village
   leaves the list by itself when a newer Mojri file shows it.

The PM picks the owner with **Change owner** on Ready to submit. The owner must
be an active Coordinator account; an Admin creates one in Admin › Users & roles.

If the page says *Mojri data is n days old*, ask the PM to upload the current
Mojri file with its date: until then the follow-up count is paused on purpose.
